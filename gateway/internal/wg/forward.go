// Exit forwarder — the crux of the gateway. This is the tun2socks /
// Tailscale-tsnet "exit node" pattern: the client routes 0.0.0.0/0 into the
// tunnel, the gVisor netstack terminates every flow to arbitrary destination
// IPs, and for each flow we net.Dial the real destination on the HOST network
// and splice bytes. Outbound connections originate from the container's
// netns and therefore exit with the Flux node's public IP — a VPN exit.
//
// Two things make the stack accept traffic to IPs it doesn't own:
//   - PromiscuousMode:  accept frames for any destination.
//   - Spoofing:         allow originating replies from arbitrary source IPs.
//
// Both are set per-NIC below, then a TCP forwarder (tcp.NewForwarder) and a
// UDP forwarder (udp.NewForwarder) hand us each new flow.
package wg

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/netip"
	"sync"
	"time"

	"github.com/runonflux/cumulusvpn-gateway/internal/limiter"

	"gvisor.dev/gvisor/pkg/tcpip"
	"gvisor.dev/gvisor/pkg/tcpip/adapters/gonet"
	"gvisor.dev/gvisor/pkg/tcpip/stack"
	"gvisor.dev/gvisor/pkg/tcpip/transport/tcp"
	"gvisor.dev/gvisor/pkg/tcpip/transport/udp"
	"gvisor.dev/gvisor/pkg/waiter"
)

// nicID is the single NIC created by netstack.CreateNetTUN.
// POC: confirm the NIC id netstack uses (it is 1 in current wireguard-go).
const nicID tcpip.NICID = 1

// hard-blocked SMTP submission ports — always denied (docs/06-legal-abuse.md).
var smtpBlocked = map[uint16]struct{}{25: {}, 465: {}, 587: {}}

// wgFleetPort is the WireGuard UDP listen port of every gateway in the fleet
// (config.WGListenPort). Multi-hop (docs/11-multihop.md) makes the ENTRY
// gateway forward a premium peer's traffic to another gateway's :51820/udp
// (the EXIT). Kept here as a local const so the wg package need not import
// config; the two must stay in sync (both are protocol constants).
const wgFleetPort uint16 = 51820

// copyBufSize bounds a single WaitN charge; must stay <= the free burst.
const copyBufSize = 32 * 1024

// Forwarder wires the gVisor stack's TCP/UDP forwarders to host sockets.
type Forwarder struct {
	dev        *Device
	lim        *limiter.Manager
	dialer     net.Dialer
	allow      map[uint16]struct{} // egress allowlist; empty = allow all (minus SMTP)
	fleetAllow bool                // implicitly permit UDP 51820 to peer gateways (multi-hop)
	stk        *stack.Stack        // cached from dev.Stack() at Start
	udpConn    sync.WaitGroup
}

// NewForwarder builds a forwarder. allowPorts empty => allow-all (minus SMTP).
// fleetAllow (default true, see config.GatewayFleetAllow) keeps UDP 51820
// reachable even under a restrictive allowlist so multi-hop ENTRY->EXIT
// forwarding works — see portAllowed.
func NewForwarder(dev *Device, lim *limiter.Manager, allowPorts []uint16, fleetAllow bool) *Forwarder {
	f := &Forwarder{
		dev:        dev,
		lim:        lim,
		dialer:     net.Dialer{Timeout: 10 * time.Second},
		fleetAllow: fleetAllow,
	}
	if len(allowPorts) > 0 {
		f.allow = make(map[uint16]struct{}, len(allowPorts))
		for _, p := range allowPorts {
			f.allow[p] = struct{}{}
		}
	}
	return f
}

// Start enables promiscuous mode + spoofing on the NIC and registers the
// TCP and UDP forwarders on the stack's transport protocol dispatch.
func (f *Forwarder) Start() error {
	s := f.dev.Stack()
	f.stk = s

	if err := s.SetPromiscuousMode(nicID, true); err != nil {
		return fmt.Errorf("forward: promiscuous: %v", err)
	}
	if err := s.SetSpoofing(nicID, true); err != nil {
		return fmt.Errorf("forward: spoofing: %v", err)
	}

	// TCP: 1024 in-flight half-open forwards before the stack starts
	// dropping SYNs — a coarse SYN-flood guard.
	// POC: also enforce per-peer new-flows/s ceilings here
	// (docs/03-gateway.md "Per-peer connection-rate ceilings").
	tcpFwd := tcp.NewForwarder(s, 0, 1024, f.handleTCP)
	s.SetTransportProtocolHandler(tcp.ProtocolNumber, tcpFwd.HandlePacket)

	udpFwd := udp.NewForwarder(s, f.handleUDP)
	s.SetTransportProtocolHandler(udp.ProtocolNumber, udpFwd.HandlePacket)

	return nil
}

// handleTCP terminates one client TCP flow and splices it to the real dest.
func (f *Forwarder) handleTCP(r *tcp.ForwarderRequest) {
	id := r.ID()
	srcIP := addrFrom(id.RemoteAddress)
	dstIP := addrFrom(id.LocalAddress)
	dstPort := id.LocalPort

	peer, ok := f.dev.PeerByAddr(srcIP)
	if !ok {
		r.Complete(true) // unknown source -> RST
		return
	}
	if !f.portAllowed(dstPort, false /* isUDP */) {
		r.Complete(true) // policy block -> RST
		return
	}

	// Accept the client side: complete the handshake into a gonet.Conn.
	var wq waiter.Queue
	ep, tcpErr := r.CreateEndpoint(&wq)
	if tcpErr != nil {
		r.Complete(true)
		return
	}
	r.Complete(false)
	clientConn := gonet.NewTCPConn(&wq, ep)

	// Dial the real destination on the HOST network stack.
	dst := net.JoinHostPort(dstIP.String(), fmt.Sprintf("%d", dstPort))
	hostConn, err := f.dialer.Dial("tcp", dst)
	if err != nil {
		clientConn.Close()
		return
	}

	lp := f.lim.Get(peer)
	go f.splice(clientConn, hostConn, lp)
}

// splice copies bidirectionally, gating both directions through the peer's
// token bucket and tallying bytes for /v1/status. Closes both ends when
// either direction finishes.
func (f *Forwarder) splice(client, host net.Conn, lp *limiter.Peer) {
	var once sync.Once
	closeBoth := func() { once.Do(func() { client.Close(); host.Close() }) }

	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); f.rateCopy(host, client, lp); closeBoth() }() // client -> internet (upload)
	go func() { defer wg.Done(); f.rateCopy(client, host, lp); closeBoth() }() // internet -> client (download)
	wg.Wait()
}

// rateCopy is io.Copy with a per-peer token-bucket gate on each chunk.
// POC: replace with a batched implementation (readv/writev, larger buffers)
// once the M1 benchmark identifies the copy loop as a bottleneck — WaitN per
// 32 KiB is fine for the free tier but adds syscalls at premium line rate.
func (f *Forwarder) rateCopy(dst io.Writer, src io.Reader, lp *limiter.Peer) {
	buf := make([]byte, copyBufSize)
	for {
		n, rerr := src.Read(buf)
		if n > 0 {
			// Gate before writing; ctx.Background so a slow peer waits
			// rather than dropping (WireGuard has no flow control here).
			if err := lp.WaitN(context.Background(), n); err != nil {
				return
			}
			if _, werr := dst.Write(buf[:n]); werr != nil {
				return
			}
			lp.Count(n)
		}
		if rerr != nil {
			return
		}
	}
}

// handleUDP relays one client UDP "flow" (5-tuple) to the real destination.
// gVisor's udp.Forwarder synthesizes a flow per new 5-tuple; we open a host
// UDP socket, forward client->host, and pump host->client until idle.
func (f *Forwarder) handleUDP(r *udp.ForwarderRequest) {
	id := r.ID()
	srcIP := addrFrom(id.RemoteAddress)
	dstIP := addrFrom(id.LocalAddress)
	dstPort := id.LocalPort

	peer, ok := f.dev.PeerByAddr(srcIP)
	if !ok {
		return
	}
	if !f.portAllowed(dstPort, true /* isUDP */) {
		return
	}

	var wq waiter.Queue
	ep, tcpErr := r.CreateEndpoint(&wq)
	if tcpErr != nil {
		return
	}
	clientConn := gonet.NewUDPConn(f.stk, &wq, ep)

	dst := net.JoinHostPort(dstIP.String(), fmt.Sprintf("%d", dstPort))
	hostConn, err := f.dialer.Dial("udp", dst)
	if err != nil {
		clientConn.Close()
		return
	}

	lp := f.lim.Get(peer)
	f.udpConn.Add(1)
	go func() {
		defer f.udpConn.Done()
		f.relayUDP(clientConn, hostConn, lp)
	}()
}

// relayUDP pumps datagrams both ways with an idle timeout (userspace conntrack).
func (f *Forwarder) relayUDP(client, host net.Conn, lp *limiter.Peer) {
	const idle = 30 * time.Second
	var once sync.Once
	closeBoth := func() { once.Do(func() { client.Close(); host.Close() }) }
	defer closeBoth()

	pump := func(dst, src net.Conn) {
		buf := make([]byte, 64*1024)
		for {
			_ = src.SetReadDeadline(time.Now().Add(idle))
			n, rerr := src.Read(buf)
			if n > 0 {
				if err := lp.WaitN(context.Background(), n); err != nil {
					return
				}
				if _, werr := dst.Write(buf[:n]); werr != nil {
					return
				}
				lp.Count(n)
			}
			if rerr != nil {
				return
			}
		}
	}
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); pump(host, client); closeBoth() }()
	go func() { defer wg.Done(); pump(client, host); closeBoth() }()
	wg.Wait()
}

// portAllowed applies the SMTP hard-block then the optional allowlist.
//
// Multi-hop guarantee (docs/11-multihop.md): the ENTRY gateway must be able to
// forward a premium peer's traffic to another gateway's :51820/udp (the EXIT).
// The default empty allowlist (allow-all-minus-SMTP) already permits this. But
// under a RESTRICTIVE CVPN_EGRESS_ALLOW_PORTS that omits 51820, forwarding
// would be blocked and multi-hop would break — so when fleetAllow is set
// (CVPN_GATEWAY_FLEET_ALLOW, default true) we implicitly permit UDP 51820
// regardless of the allowlist. This only widens UDP:51820 (never TCP, never any
// other port), so it does not loosen the abuse posture for normal egress.
//
// POC: if/when the fleet's WG port is discovered/rotated rather than fixed at
// 51820, gate this on the destination IP being a known gateway (directory.json)
// instead of a bare port match, to avoid a generic UDP:51820 egress hole.
func (f *Forwarder) portAllowed(port uint16, isUDP bool) bool {
	if _, blocked := smtpBlocked[port]; blocked {
		return false
	}
	if f.allow == nil {
		return true // allow-all mode (minus SMTP)
	}
	if _, ok := f.allow[port]; ok {
		return true
	}
	// Multi-hop escape hatch: keep gateway-to-gateway WG reachable.
	if f.fleetAllow && isUDP && port == wgFleetPort {
		return true
	}
	return false
}

// addrFrom converts a gVisor tcpip.Address to a netip.Addr.
func addrFrom(a tcpip.Address) netip.Addr {
	// tcpip.Address is byte-slice-backed; AsSlice gives raw v4/v16 bytes.
	// POC: 16-byte slices become IPv6 here — fine once ULA tunnel addrs land.
	na, _ := netip.AddrFromSlice(a.AsSlice())
	return na.Unmap()
}
