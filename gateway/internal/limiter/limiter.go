// Package limiter implements the free/paid enforcement mechanism: a
// token-bucket rate limiter per WireGuard peer, applied by the forwarder on
// both directions of every flow at the netstack boundary.
//
// Tier flips are instant: the entitlement scanner calls SetTier and the
// underlying rate.Limiter is retuned in place, affecting in-flight flows
// without any reconnect (docs/03-gateway.md "Rate limiting").
//
// Premium is two buckets in series: a sustained one (the advertised per-peer
// rate) with a large burst, and a peak one that caps how fast that burst can
// drain. A peer that has been quiet can run at the peak rate until the
// sustained bucket empties, then settles at the sustained rate; it refills
// only while the peer stays below that rate. Speed tests, downloads and
// page loads feel fast, while round-the-clock bulk traffic (seeding) gets the
// sustained rate and no more.
package limiter

import (
	"context"
	"sync"
	"sync/atomic"

	"golang.org/x/time/rate"
)

const (
	// freeBurst lets pages still feel snappy on the free tier (~1 MB).
	freeBurst = 1 << 20
	// peakBurst is the peak bucket's burst (~4 MB), so the peak ceiling is
	// enforced tightly. Also the sustained burst when peak bursting is off.
	peakBurst = 4 << 20
	// bytesPerMbit converts Mbit/s to bytes/s (base-10 networking units:
	// 1 Mbit/s = 1e6 bits/s = 125_000 bytes/s).
	bytesPerMbit = 125_000
)

// Peer is the per-pubkey limiter state shared by all of that peer's flows.
type Peer struct {
	lim     *rate.Limiter // free rate, or the premium sustained rate
	peak    *rate.Limiter // premium peak rate; rate.Inf on the free tier
	premium atomic.Bool
	bytes   atomic.Uint64 // total bytes forwarded (both directions)

	// TCPFlows and UDPFlows count this peer's live forwarded flows across
	// every transport's forwarder, for the per-peer flow cap
	// (wg.Forwarder.SetMaxPeerFlows).
	TCPFlows atomic.Int64
	UDPFlows atomic.Int64
}

// WaitN blocks until n bytes' worth of tokens are available (or ctx ends).
// n must be <= the smallest configured burst (the forwarder's copy buffer is
// 32 KiB, well under the 1 MiB free burst).
func (p *Peer) WaitN(ctx context.Context, n int) error {
	if err := p.peak.WaitN(ctx, n); err != nil {
		return err
	}
	return p.lim.WaitN(ctx, n)
}

// Count records n forwarded bytes for /v1/status accounting.
// Memory-only by design: no traffic logging (docs/03-gateway.md).
func (p *Peer) Count(n int) {
	p.bytes.Add(uint64(n))
}

// Bytes returns the total bytes forwarded for this peer since boot.
func (p *Peer) Bytes() uint64 {
	return p.bytes.Load()
}

// Premium reports the currently applied tier.
func (p *Peer) Premium() bool {
	return p.premium.Load()
}

// Manager maps WireGuard pubkeys (base64) to their limiters.
type Manager struct {
	freeRate     rate.Limit
	premiumRate  rate.Limit
	premiumBurst int        // sustained bucket size in bytes
	peakRate     rate.Limit // rate.Inf when peak bursting is off
	mu           sync.Mutex
	peers        map[string]*Peer
	freeCount    atomic.Int64
}

// New creates a Manager with the free tier set to freeRateKBps kilobytes/s and
// the premium per-peer sustained rate set to premiumRateMbps megabits/s. The
// premium cap exists because a Flux node's uplink is shared with other apps
// and other peers; capping each user's sustained rate (default 50 Mbit/s)
// means no single peer can starve the node and several premium peers coexist.
//
// Premium peers may burst at up to premiumPeakMbps until burstMB megabytes
// above the sustained rate are spent (see the package doc). premiumPeakMbps
// <= premiumRateMbps or burstMB <= 0 turns bursting off: a flat
// premiumRateMbps ceiling with a ~4 MB burst.
func New(freeRateKBps, premiumRateMbps, premiumPeakMbps, burstMB int) *Manager {
	m := &Manager{
		freeRate:     rate.Limit(freeRateKBps * 1024),
		premiumRate:  rate.Limit(premiumRateMbps * bytesPerMbit),
		premiumBurst: peakBurst,
		peakRate:     rate.Inf,
		peers:        make(map[string]*Peer),
	}
	if premiumPeakMbps > premiumRateMbps && burstMB > 0 {
		m.peakRate = rate.Limit(premiumPeakMbps * bytesPerMbit)
		m.premiumBurst = burstMB << 20
	}
	return m
}

// Get returns the limiter for pubkey, creating it (free tier) if unknown.
func (m *Manager) Get(pubkey string) *Peer {
	m.mu.Lock()
	defer m.mu.Unlock()
	p, ok := m.peers[pubkey]
	if !ok {
		p = &Peer{
			lim:  rate.NewLimiter(m.freeRate, freeBurst),
			peak: rate.NewLimiter(rate.Inf, peakBurst),
		}
		m.peers[pubkey] = p
		m.freeCount.Add(1)
	}
	return p
}

// BytesOf returns a peer's byte counter WITHOUT creating an entry — 0 if the
// peer is unknown. Read-only surfaces (e.g. the unauthenticated /v1/status
// handler) MUST use this rather than Get: Get inserts a peer and bumps the
// capacity counters, so a flood of status queries for arbitrary keys would
// otherwise manufacture phantom peers and exhaust the enroll capacity guard.
func (m *Manager) BytesOf(pubkey string) uint64 {
	m.mu.Lock()
	defer m.mu.Unlock()
	if p, ok := m.peers[pubkey]; ok {
		return p.Bytes()
	}
	return 0
}

// SetTier switches a peer between free and premium. Retunes the existing
// rate.Limiter so in-flight WaitN calls pick the new rate up immediately.
func (m *Manager) SetTier(pubkey string, premium bool) {
	p := m.Get(pubkey)
	if p.premium.Swap(premium) == premium {
		return // no change
	}
	if premium {
		p.lim.SetLimit(m.premiumRate)
		p.lim.SetBurst(m.premiumBurst)
		p.peak.SetLimit(m.peakRate)
		m.freeCount.Add(-1)
	} else {
		p.lim.SetLimit(m.freeRate)
		p.lim.SetBurst(freeBurst)
		p.peak.SetLimit(rate.Inf)
		m.freeCount.Add(1)
	}
}

// Remove drops a peer's limiter state (peer eviction).
func (m *Manager) Remove(pubkey string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if p, ok := m.peers[pubkey]; ok {
		if !p.premium.Load() {
			m.freeCount.Add(-1)
		}
		delete(m.peers, pubkey)
	}
}

// Counts returns (free, total) peer counts for capacity guards and /v1/info.
func (m *Manager) Counts() (free, total int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return int(m.freeCount.Load()), len(m.peers)
}

// TotalBytes returns the aggregate bytes forwarded across all live peers since
// boot (both directions). Sampled over time it yields the gateway's real
// throughput, which drives the /v1/info load figure.
func (m *Manager) TotalBytes() uint64 {
	m.mu.Lock()
	defer m.mu.Unlock()
	var total uint64
	for _, p := range m.peers {
		total += p.Bytes()
	}
	return total
}

// POC: add an aggregate free-pool limiter (single shared rate.Limiter sized
// at ~30% of instance throughput) chained after the per-peer one, so the sum
// of free-tier traffic can never starve premium peers (docs/03-gateway.md
// "Capacity guards").
