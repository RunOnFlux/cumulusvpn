// Package wgnest builds a genuinely nested (multi-hop) WireGuard tunnel entirely
// in userspace, using the same wireguard-go + gVisor netstack stack as the
// CumulusVPN gateway. No forked wireguard-go is required.
//
// Topology (docs/11-multihop.md):
//
//	inner tun (0.0.0.0/0) → INNER device (peer = EXIT) → UDP to <exitIP>:51820
//	  ─ via ─→ OUTER device (peer = ENTRY, AllowedIPs = <exitIP>/32) → real socket
//
// The trick is the INNER device's conn.Bind: instead of a real UDP socket, it
// dials a UDP socket ON THE OUTER DEVICE'S NETSTACK to <exitIP>:51820. The outer
// netstack routes that (dst = exitIP) out its default route into the OUTER
// wireguard device, which — because its only AllowedIPs is <exitIP>/32 —
// encrypts it to the ENTRY gateway. The entry gateway forwards UDP:51820 to the
// exit (fleet-allow), the exit terminates the INNER WireGuard session and
// egresses. Return traffic reverses. The client key K is the same at both hops
// (one payment covers both), and no single gateway sees both who you are and
// where you go.
//
// The OUTER device is created here (netstack). The INNER device's tun is
// supplied by the caller: on a phone it is the VpnService fd; in tests it is a
// second netstack so traffic can be driven through the tunnel.
package wgnest

import (
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net/netip"
	"strconv"
	"strings"

	"github.com/amnezia-vpn/amneziawg-go/conn"
	"github.com/amnezia-vpn/amneziawg-go/device"
	"github.com/amnezia-vpn/amneziawg-go/tun"
	"github.com/amnezia-vpn/amneziawg-go/tun/netstack"
)

const (
	wgPort   = 51820
	outerMTU = 1420 // one WireGuard header of headroom
)

// Gateway identifies one hop: its WireGuard server public key, public IP, and
// the tunnel address this client was assigned when it enrolled there.
type Gateway struct {
	PubKeyB64  string     // WireGuard server public key (base64)
	IP         netip.Addr // gateway public IP
	AssignedIP netip.Addr // this client's assigned 10.8.x.y at this gateway
	// Port is the WG endpoint UDP port; 0 means the default 51820. The
	// obfuscated (AmneziaWG) transport listens on a different port (51821).
	Port int
	// Obfs is the device-level AmneziaWG UAPI (jc=…\njmin=…\n…) applied to this
	// hop's device before the peer. "" = vanilla WireGuard. For multi-hop only
	// the ENTRY hop is obfuscated — the exit hop rides inside the outer tunnel,
	// invisible to the local network, so it stays vanilla.
	Obfs string
}

// port returns the endpoint port, defaulting to the standard WG port.
func (g Gateway) port() int {
	if g.Port == 0 {
		return wgPort
	}
	return g.Port
}

// NestedTunnel owns the two stacked wireguard-go devices. Close() tears both
// down (inner first, then outer).
type NestedTunnel struct {
	inner *device.Device
	outer *device.Device
}

// Start brings up the nested tunnel. `clientPrivB64` is the client's WireGuard
// private key (base64), shared by both hops. `innerTun` is the tun the real
// 0.0.0.0/0 traffic flows over (caller-owned). `logLevel` is a device.LogLevel*.
func Start(clientPrivB64 string, entry, exit Gateway, innerTun tun.Device, logLevel int) (*NestedTunnel, error) {
	// The caller hands us ownership of innerTun. Until it is wrapped in the inner
	// device (whose Close() then owns it), close it ourselves on any early error
	// so a failed connect doesn't leak the caller's tun fd (on Android the fd is
	// detached from the ParcelFileDescriptor and never reclaimed otherwise).
	innerOwned := false
	defer func() {
		if !innerOwned {
			_ = innerTun.Close()
		}
	}()

	privHex, err := b64ToHex(clientPrivB64)
	if err != nil {
		return nil, fmt.Errorf("client key: %w", err)
	}
	entryPubHex, err := b64ToHex(entry.PubKeyB64)
	if err != nil {
		return nil, fmt.Errorf("entry key: %w", err)
	}
	exitPubHex, err := b64ToHex(exit.PubKeyB64)
	if err != nil {
		return nil, fmt.Errorf("exit key: %w", err)
	}

	// ---- OUTER device: a netstack whose only route to the exit IP goes through
	// the entry tunnel. Its client address is the ENTRY-assigned IP. ----
	outerTun, outerNet, err := netstack.CreateNetTUN(
		[]netip.Addr{entry.AssignedIP},
		[]netip.Addr{entry.AssignedIP}, // DNS unused by the outer device
		outerMTU,
	)
	if err != nil {
		return nil, fmt.Errorf("outer netstack: %w", err)
	}
	outer := device.NewDevice(outerTun, conn.NewDefaultBind(), device.NewLogger(logLevel, "outer "))
	// Obfuscation (if any) applies to the ENTRY hop only; the device-level obfs
	// UAPI goes between private_key and the peer's public_key.
	outerCfg := fmt.Sprintf("private_key=%s\n", privHex) + entry.Obfs + fmt.Sprintf(
		"public_key=%s\nendpoint=%s:%d\nallowed_ip=%s/32\npersistent_keepalive_interval=15\n",
		entryPubHex, entry.IP, entry.port(), exit.IP,
	)
	if err := outer.IpcSet(outerCfg); err != nil {
		outer.Close()
		return nil, fmt.Errorf("outer IpcSet: %w", err)
	}
	if err := outer.Up(); err != nil {
		outer.Close()
		return nil, fmt.Errorf("outer up: %w", err)
	}

	// ---- INNER device: real traffic tun, but its socket is a UDP conn ON the
	// outer netstack to <exitIP>:51820, so its packets ride the outer tunnel. ----
	exitEndpoint := netip.AddrPortFrom(exit.IP, wgPort)
	inner := device.NewDevice(innerTun, newNetstackBind(outerNet, exitEndpoint), device.NewLogger(logLevel, "inner "))
	innerOwned = true // inner.Close() now owns innerTun
	innerCfg := fmt.Sprintf(
		"private_key=%s\npublic_key=%s\nendpoint=%s\nallowed_ip=0.0.0.0/0\nallowed_ip=::/0\npersistent_keepalive_interval=15\n",
		privHex, exitPubHex, exitEndpoint,
	)
	if err := inner.IpcSet(innerCfg); err != nil {
		inner.Close()
		outer.Close()
		return nil, fmt.Errorf("inner IpcSet: %w", err)
	}
	if err := inner.Up(); err != nil {
		inner.Close()
		outer.Close()
		return nil, fmt.Errorf("inner up: %w", err)
	}

	return &NestedTunnel{inner: inner, outer: outer}, nil
}

// StartSingle brings up a plain SINGLE-hop tunnel: one wireguard-go device bound
// to `t` (the OS tun), peer = the single gateway, over a real UDP socket
// (conn.NewDefaultBind()). This is the non-nested path — the OS tun's 0.0.0.0/0
// traffic goes straight out one WireGuard device. It lives here, in the same
// core as the nested path, so a client (notably the iOS Packet Tunnel extension)
// runs ONE Go runtime for both single- and multi-hop instead of also linking
// WireGuardKit's libwg-go (two Go runtimes in one process crash — see docs/13).
//
// The device carries no interface address: on a real tun the client address /
// DNS / routes are set by the OS (NEPacketTunnelNetworkSettings on iOS), so
// `gw.AssignedIP` is unused here. Reuses NestedTunnel (single device as `inner`,
// `outer` nil) so Stats/Close work unchanged.
func StartSingle(clientPrivB64 string, gw Gateway, t tun.Device, logLevel int) (*NestedTunnel, error) {
	// The caller hands us ownership of t; close it on any error before the device
	// wraps it, so a failed connect doesn't leak the caller's tun fd.
	tOwned := false
	defer func() {
		if !tOwned {
			_ = t.Close()
		}
	}()

	privHex, err := b64ToHex(clientPrivB64)
	if err != nil {
		return nil, fmt.Errorf("client key: %w", err)
	}
	pubHex, err := b64ToHex(gw.PubKeyB64)
	if err != nil {
		return nil, fmt.Errorf("server key: %w", err)
	}
	dev := device.NewDevice(t, conn.NewDefaultBind(), device.NewLogger(logLevel, "wg "))
	tOwned = true // dev.Close() now owns t
	// Device-level obfs UAPI (if any) sits between private_key and the peer.
	cfg := fmt.Sprintf("private_key=%s\n", privHex) + gw.Obfs + fmt.Sprintf(
		"public_key=%s\nendpoint=%s:%d\nallowed_ip=0.0.0.0/0\nallowed_ip=::/0\npersistent_keepalive_interval=15\n",
		pubHex, gw.IP, gw.port(),
	)
	if err := dev.IpcSet(cfg); err != nil {
		dev.Close()
		return nil, fmt.Errorf("IpcSet: %w", err)
	}
	if err := dev.Up(); err != nil {
		dev.Close()
		return nil, fmt.Errorf("up: %w", err)
	}
	return &NestedTunnel{inner: dev}, nil
}

// Stats reports the inner tunnel's cumulative byte counters and the last
// handshake time (unix seconds). The INNER device carries all real traffic
// (AllowedIPs 0.0.0.0/0), so its counters are the user-visible totals. Values
// are read from wireguard-go's IPC surface; zeros mean "no data yet".
func (t *NestedTunnel) Stats() (rxBytes, txBytes, lastHandshakeSec int64) {
	if t.inner == nil {
		return 0, 0, 0
	}
	get, err := t.inner.IpcGet()
	if err != nil {
		return 0, 0, 0
	}
	for _, line := range strings.Split(get, "\n") {
		key, val, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		n, err := strconv.ParseInt(strings.TrimSpace(val), 10, 64)
		if err != nil {
			continue
		}
		switch key {
		case "rx_bytes":
			rxBytes = n
		case "tx_bytes":
			txBytes = n
		case "last_handshake_time_sec":
			lastHandshakeSec = n
		}
	}
	return rxBytes, txBytes, lastHandshakeSec
}

// Rebind reopens the tunnel's real UDP socket on the current default network
// and clears every peer's cached source address, so the next keepalive leaves
// from the new interface.
//
// This is the client half of WireGuard roaming. The server half already works:
// a gateway updates a peer's endpoint from any authenticated packet, so the
// moment one datagram arrives from the new address the session continues. What
// does NOT happen by itself is the client noticing — the socket stays bound to
// the interface that has gone away, so nothing is ever sent and the tunnel
// blackholes with the OS still reporting it up. Callers wire this to a
// platform network-change signal (Android ConnectivityManager, iOS
// NEProvider/NWPathMonitor).
//
// Only the device that owns a REAL socket is rebound. In a nested tunnel that
// is the outer device; the inner one's Bind is a UDP conn on the outer
// netstack (see bind.go), which has no OS socket to reopen and whose peer
// endpoint never changes. Rebinding it would tear down a working conn to
// re-dial the same address.
//
// Safe to call when nothing changed: BindUpdate closes and reopens on the same
// port, which costs a few milliseconds and one lost keepalive at worst. It is
// NOT useful for the wg-tls transport, whose device points at a local bridge —
// the socket that actually broke there is the bridge's TCP connection, which
// only a reconnect can repair.
//
// Must not overlap an IpcSet on the same device. BindUpdate starts receive
// goroutines that read the device's obfuscation headers, and IpcSetOperation
// writes those same fields without holding a lock against them — so a rebind
// racing a config change is a data race inside amneziawg-go, not merely a
// surprising ordering. Callers get this for free by starting their
// network-change watcher only AFTER Start/StartSingle has returned, which is
// what both mobile services do; anything that reconfigures a live device would
// have to serialise against this.
func (t *NestedTunnel) Rebind() error {
	dev := t.outer
	if dev == nil {
		dev = t.inner
	}
	if dev == nil {
		return errors.New("wgnest: tunnel is closed")
	}
	return dev.BindUpdate()
}

// Close tears the tunnel down.
func (t *NestedTunnel) Close() {
	if t.inner != nil {
		t.inner.Close()
	}
	if t.outer != nil {
		t.outer.Close()
	}
}

func b64ToHex(b64 string) (string, error) {
	raw, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return "", err
	}
	if len(raw) != 32 {
		return "", fmt.Errorf("key must be 32 bytes, got %d", len(raw))
	}
	return hex.EncodeToString(raw), nil
}
