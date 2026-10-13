// Package dnsproxy answers the DNS that tunnel peers send through the gateway
// and sends it on encrypted, as DNS over HTTPS (RFC 8484), to the same public
// resolver the client addressed.
//
// Why at the gateway (docs/03-gateway.md "DNS"): gateways run on Flux nodes
// owned by independent operators. Relayed as-is, a peer's port-53 lookups
// leave the node in plain text, readable by the node's operator and network,
// and rewritable by networks in the gateway's own country that intercept DNS.
// Answering in-process and re-sending over HTTPS keeps both out, with no
// client change: clients keep sending ordinary DNS to 1.1.1.1 inside the
// tunnel.
//
// The client's choice of resolver is kept (see Providers), and a destination
// that isn't a known provider is not intercepted at all; the forwarder
// relays it as before.
//
// If DoH to a provider fails (resolver unreachable, or a network blocking
// DoH from the node), the lookup goes out as ordinary DNS to the same
// address rather than failing: availability over strictness. Every such
// lookup is counted (Stats.Fallbacks, served in /v1/info) so a node stuck in
// fallback is visible from outside.
//
// Nothing is logged or cached: a lookup lives in memory for its round trip.
package dnsproxy

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"sync/atomic"
	"time"
)

const (
	mediaType = "application/dns-message"
	// maxMessage is the largest DNS message (its TCP length prefix is 16 bits).
	maxMessage = 65535
	// lookupTimeout bounds one lookup end to end, DoH attempt plus fallback.
	lookupTimeout = 5 * time.Second
	// dohTimeout bounds the DoH attempt, leaving room for the fallback.
	dohTimeout = 2500 * time.Millisecond
	// defaultMaxInFlight bounds concurrent lookups across the gateway. Over
	// it, new lookups are shed (the client retries) rather than queued.
	defaultMaxInFlight = 512
	// After breakerTrips consecutive DoH failures a provider is skipped for
	// breakerCooldown (straight to the fallback), so a network that blocks
	// DoH costs one slow lookup per cooldown instead of a stall on every one.
	breakerTrips    = 3
	breakerCooldown = time.Minute
)

// ErrBusy reports a lookup shed because too many are in flight.
var ErrBusy = errors.New("dnsproxy: too many lookups in flight")

var errNotHandled = errors.New("dnsproxy: destination is not a known resolver")

// Options configures a Proxy. The zero value is the production setup; the
// fields exist for tests.
type Options struct {
	// Providers replaces the built-in Providers table.
	Providers []Provider
	// RootCAs verifies the resolvers' certificates (nil = system roots).
	RootCAs *x509.CertPool
	// DialAddr maps a resolver address to the host:port dialed for DoH
	// (nil = "<addr>:443").
	DialAddr func(netip.Addr) string
	// Plain is the fallback exchange (nil = ordinary DNS to <dst>:53).
	Plain func(ctx context.Context, dst netip.Addr, query []byte) ([]byte, error)
	// MaxInFlight bounds concurrent lookups (0 = 512).
	MaxInFlight int
}

// Proxy resolves intercepted lookups. Safe for concurrent use; one instance
// is shared by every forwarder so they share DoH connections and counters.
type Proxy struct {
	upstreams map[netip.Addr]*upstream
	plain     func(ctx context.Context, dst netip.Addr, query []byte) ([]byte, error)
	slots     chan struct{}

	encrypted atomic.Uint64
	fallbacks atomic.Uint64
	failed    atomic.Uint64
}

// Stats are lifetime lookup counters, served in /v1/info. They count
// lookups only; nothing about what was looked up is kept.
type Stats struct {
	// Encrypted lookups were answered over DoH.
	Encrypted uint64 `json:"encrypted"`
	// Fallbacks went out as ordinary DNS because DoH failed.
	Fallbacks uint64 `json:"fallbacks"`
	// Failed got no answer either way.
	Failed uint64 `json:"failed"`
}

// New builds a Proxy for opts.Providers (or the built-in table).
func New(opts Options) *Proxy {
	provs := opts.Providers
	if provs == nil {
		provs = Providers
	}
	dialAddr := opts.DialAddr
	if dialAddr == nil {
		dialAddr = func(a netip.Addr) string { return netip.AddrPortFrom(a, 443).String() }
	}
	n := opts.MaxInFlight
	if n <= 0 {
		n = defaultMaxInFlight
	}
	p := &Proxy{
		upstreams: make(map[netip.Addr]*upstream),
		plain:     opts.Plain,
		slots:     make(chan struct{}, n),
	}
	if p.plain == nil {
		p.plain = plainExchange
	}
	for _, pr := range provs {
		u := newUpstream(pr, opts.RootCAs, dialAddr)
		for _, a := range pr.Addrs {
			p.upstreams[a] = u
		}
	}
	return p
}

// Handles reports whether lookups sent to dst are answered here.
func (p *Proxy) Handles(dst netip.Addr) bool {
	_, ok := p.upstreams[dst]
	return ok
}

// Stats returns the lifetime counters.
func (p *Proxy) Stats() Stats {
	return Stats{
		Encrypted: p.encrypted.Load(),
		Fallbacks: p.fallbacks.Load(),
		Failed:    p.failed.Load(),
	}
}

// Exchange answers query, a wire-format DNS message a client sent to dst:53,
// returning the wire-format answer with the client's message ID. It returns
// ErrNotDNS for anything that isn't a standard query and ErrBusy when shed.
func (p *Proxy) Exchange(ctx context.Context, dst netip.Addr, query []byte) ([]byte, error) {
	u := p.upstreams[dst]
	if u == nil {
		return nil, errNotHandled
	}
	if !IsQuery(query) {
		return nil, ErrNotDNS
	}
	select {
	case p.slots <- struct{}{}:
		defer func() { <-p.slots }()
	default:
		return nil, ErrBusy
	}
	ctx, cancel := context.WithTimeout(ctx, lookupTimeout)
	defer cancel()

	if u.available() {
		resp, err := u.exchange(ctx, query)
		u.record(err)
		if err == nil {
			p.encrypted.Add(1)
			return resp, nil
		}
	}
	p.fallbacks.Add(1)
	resp, err := p.plain(ctx, dst, query)
	if err != nil {
		p.failed.Add(1)
		return nil, err
	}
	return resp, nil
}

// upstream is one provider's DoH endpoint: an HTTP/2 client pinned to the
// provider's own addresses, plus its failure breaker.
type upstream struct {
	url    string
	client *http.Client

	failures  atomic.Int32
	downUntil atomic.Int64 // unix nanos; DoH skipped until then
}

func newUpstream(pr Provider, roots *x509.CertPool, dialAddr func(netip.Addr) string) *upstream {
	dialer := &net.Dialer{Timeout: 2 * time.Second}
	var preferred atomic.Uint32 // index of the last address that connected
	tr := &http.Transport{
		// Dial the resolver's own addresses, never a lookup of Host: the
		// gateway must neither depend on nor leak through the node's resolver.
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			var lastErr error
			start := int(preferred.Load())
			for i := range pr.Addrs {
				idx := (start + i) % len(pr.Addrs)
				c, err := dialer.DialContext(ctx, "tcp", dialAddr(pr.Addrs[idx]))
				if err == nil {
					preferred.Store(uint32(idx))
					return c, nil
				}
				lastErr = err
			}
			return nil, lastErr
		},
		TLSClientConfig:       &tls.Config{ServerName: pr.Host, RootCAs: roots, MinVersion: tls.VersionTLS12},
		ForceAttemptHTTP2:     true,
		MaxIdleConnsPerHost:   2,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   dohTimeout,
		ResponseHeaderTimeout: dohTimeout,
	}
	return &upstream{
		url:    "https://" + pr.Host + "/dns-query",
		client: &http.Client{Transport: tr, Timeout: dohTimeout},
	}
}

func (u *upstream) available() bool {
	return time.Now().UnixNano() >= u.downUntil.Load()
}

func (u *upstream) record(err error) {
	if err == nil {
		u.failures.Store(0)
		return
	}
	if u.failures.Add(1) >= breakerTrips {
		u.failures.Store(0)
		u.downUntil.Store(time.Now().Add(breakerCooldown).UnixNano())
	}
}

// exchange sends query over DoH. RFC 8484 §4.1: the wire ID is 0 (the
// transport already pairs request and answer); the client's ID is restored.
func (u *upstream) exchange(ctx context.Context, query []byte) ([]byte, error) {
	id := messageID(query)
	body := bytes.Clone(query)
	setMessageID(body, 0)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", mediaType)
	req.Header.Set("Accept", mediaType)
	res, err := u.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("dnsproxy: DoH status %d", res.StatusCode)
	}
	if ct := res.Header.Get("Content-Type"); !strings.HasPrefix(ct, mediaType) {
		return nil, fmt.Errorf("dnsproxy: DoH content type %q", ct)
	}
	resp, err := io.ReadAll(io.LimitReader(res.Body, maxMessage+1))
	if err != nil {
		return nil, err
	}
	if len(resp) > maxMessage {
		return nil, errBadResponse
	}
	if err := checkResponse(resp); err != nil {
		return nil, err
	}
	setMessageID(resp, id)
	return resp, nil
}

// plainExchange is ordinary DNS to dst:53 over UDP, retried over TCP when the
// answer comes back truncated. It is the fallback when DoH fails.
func plainExchange(ctx context.Context, dst netip.Addr, query []byte) ([]byte, error) {
	resp, err := plainUDP(ctx, dst, query)
	if err != nil || !isTruncated(resp) {
		return resp, err
	}
	return plainTCP(ctx, dst, query)
}

func plainUDP(ctx context.Context, dst netip.Addr, query []byte) ([]byte, error) {
	var d net.Dialer
	c, err := d.DialContext(ctx, "udp", netip.AddrPortFrom(dst, 53).String())
	if err != nil {
		return nil, err
	}
	defer c.Close()
	if dl, ok := ctx.Deadline(); ok {
		_ = c.SetDeadline(dl)
	}
	if _, err := c.Write(query); err != nil {
		return nil, err
	}
	buf := make([]byte, maxMessage)
	for {
		n, err := c.Read(buf)
		if err != nil {
			return nil, err
		}
		// Skip anything that isn't the answer to this query (late or stray).
		if n >= headerLen && messageID(buf[:n]) == messageID(query) && checkResponse(buf[:n]) == nil {
			return bytes.Clone(buf[:n]), nil
		}
	}
}

func plainTCP(ctx context.Context, dst netip.Addr, query []byte) ([]byte, error) {
	var d net.Dialer
	c, err := d.DialContext(ctx, "tcp", netip.AddrPortFrom(dst, 53).String())
	if err != nil {
		return nil, err
	}
	defer c.Close()
	if dl, ok := ctx.Deadline(); ok {
		_ = c.SetDeadline(dl)
	}
	msg := make([]byte, 2+len(query))
	binary.BigEndian.PutUint16(msg, uint16(len(query)))
	copy(msg[2:], query)
	if _, err := c.Write(msg); err != nil {
		return nil, err
	}
	var lenBuf [2]byte
	if _, err := io.ReadFull(c, lenBuf[:]); err != nil {
		return nil, err
	}
	resp := make([]byte, binary.BigEndian.Uint16(lenBuf[:]))
	if _, err := io.ReadFull(c, resp); err != nil {
		return nil, err
	}
	if len(resp) < headerLen || messageID(resp) != messageID(query) || checkResponse(resp) != nil {
		return nil, errBadResponse
	}
	return resp, nil
}
