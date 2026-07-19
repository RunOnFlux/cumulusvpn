// Package limiter implements the free/paid enforcement mechanism: a
// token-bucket rate limiter per WireGuard peer, applied by the forwarder on
// both directions of every flow at the netstack boundary.
//
// Tier flips are instant: the entitlement scanner calls SetTier and the
// underlying rate.Limiter is retuned in place, affecting in-flight flows
// without any reconnect (docs/03-gateway.md "Rate limiting").
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
	// premiumBurst caps how much a premium peer can burst above its steady
	// rate (~4 MB), so the per-peer ceiling is enforced tightly.
	premiumBurst = 4 << 20
	// bytesPerMbit converts Mbit/s to bytes/s (base-10 networking units:
	// 1 Mbit/s = 1e6 bits/s = 125_000 bytes/s).
	bytesPerMbit = 125_000
)

// Peer is the per-pubkey limiter state shared by all of that peer's flows.
type Peer struct {
	lim     *rate.Limiter
	premium atomic.Bool
	bytes   atomic.Uint64 // total bytes forwarded (both directions)
}

// WaitN blocks until n bytes' worth of tokens are available (or ctx ends).
// n must be <= the smallest configured burst (the forwarder's copy buffer is
// 32 KiB, well under the 1 MiB free burst).
func (p *Peer) WaitN(ctx context.Context, n int) error {
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
	freeRate    rate.Limit
	premiumRate rate.Limit
	mu          sync.Mutex
	peers       map[string]*Peer
	freeCount   atomic.Int64
}

// New creates a Manager with the free tier set to freeRateKBps kilobytes/s and
// the premium per-peer ceiling set to premiumRateMbps megabits/s. The premium
// cap exists because a Flux node's uplink is limited (~100 Mbit/s, shared with
// other apps); capping each user well below the link (default 50 Mbit/s) means
// no single peer can starve the node and several premium peers coexist.
func New(freeRateKBps, premiumRateMbps int) *Manager {
	return &Manager{
		freeRate:    rate.Limit(freeRateKBps * 1024),
		premiumRate: rate.Limit(premiumRateMbps * bytesPerMbit),
		peers:       make(map[string]*Peer),
	}
}

// Get returns the limiter for pubkey, creating it (free tier) if unknown.
func (m *Manager) Get(pubkey string) *Peer {
	m.mu.Lock()
	defer m.mu.Unlock()
	p, ok := m.peers[pubkey]
	if !ok {
		p = &Peer{lim: rate.NewLimiter(m.freeRate, freeBurst)}
		m.peers[pubkey] = p
		m.freeCount.Add(1)
	}
	return p
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
		p.lim.SetBurst(premiumBurst)
		m.freeCount.Add(-1)
	} else {
		p.lim.SetLimit(m.freeRate)
		p.lim.SetBurst(freeBurst)
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
