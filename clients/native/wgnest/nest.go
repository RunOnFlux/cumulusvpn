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
	outerCfg := fmt.Sprintf(
		"private_key=%s\npublic_key=%s\nendpoint=%s:%d\nallowed_ip=%s/32\npersistent_keepalive_interval=15\n",
		privHex, entryPubHex, entry.IP, wgPort, exit.IP,
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
	privHex, err := b64ToHex(clientPrivB64)
	if err != nil {
		return nil, fmt.Errorf("client key: %w", err)
	}
	pubHex, err := b64ToHex(gw.PubKeyB64)
	if err != nil {
		return nil, fmt.Errorf("server key: %w", err)
	}
	dev := device.NewDevice(t, conn.NewDefaultBind(), device.NewLogger(logLevel, "wg "))
	cfg := fmt.Sprintf(
		"private_key=%s\npublic_key=%s\nendpoint=%s:%d\nallowed_ip=0.0.0.0/0\nallowed_ip=::/0\npersistent_keepalive_interval=15\n",
		privHex, pubHex, gw.IP, wgPort,
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
