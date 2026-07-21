//go:build android || ios

// Package wgmobile is the gomobile-bound surface of the nested multi-hop tunnel.
// It exposes a tiny string/int API that Kotlin (Android) and Swift (iOS) can
// call: Start over a tun file descriptor — the Android VpnService fd, or the
// iOS NEPacketTunnelFlow utun fd — and Stop by handle. All heavy lifting is in
// wgnest. The one platform difference (how to wrap the fd as a tun.Device) is
// isolated in tunFromFD (tun_android.go / tun_ios.go).
package wgmobile

import (
	"fmt"
	"net/netip"
	"sync"

	"golang.zx2c4.com/wireguard/device"
	"golang.zx2c4.com/wireguard/tun"

	wgnest "github.com/runonflux/cumulusvpn-wgnest"
)

const (
	// nestedTunMTU leaves room for TWO stacked WireGuard headers (multi-hop);
	// singleTunMTU for ONE (single-hop). Matches the NEPacketTunnelNetworkSettings
	// MTU set on the Swift side. Android reads the MTU from the fd, so these only
	// apply on iOS.
	nestedTunMTU = 1340
	singleTunMTU = 1420
)

var (
	mu     sync.Mutex
	byID   = map[int64]*wgnest.NestedTunnel{}
	nextID int64
	tunFDs = map[int64]tun.Device{}
)

// StartSingle brings up a plain single-hop tunnel over the supplied tun fd:
// one wireguard-go device, peer = the gateway, real UDP socket. Same one Go
// runtime as the nested path, so the iOS extension needn't also link
// WireGuardKit's libwg-go (two Go runtimes crash). Returns a Stop handle.
func StartSingle(clientPriv, serverPub, serverIP, serverAssigned string, tunFd int) (int64, error) {
	t, err := tunFromFD(tunFd, singleTunMTU)
	if err != nil {
		return 0, fmt.Errorf("wrap tun fd: %w", err)
	}
	serverAddr, err := netip.ParseAddr(serverIP)
	if err != nil {
		t.Close()
		return 0, fmt.Errorf("server ip: %w", err)
	}
	assignedAddr, err := netip.ParseAddr(serverAssigned)
	if err != nil {
		t.Close()
		return 0, fmt.Errorf("assigned ip: %w", err)
	}
	nt, err := wgnest.StartSingle(
		clientPriv,
		wgnest.Gateway{PubKeyB64: serverPub, IP: serverAddr, AssignedIP: assignedAddr},
		t,
		device.LogLevelError,
	)
	if err != nil {
		return 0, err
	}
	mu.Lock()
	nextID++
	id := nextID
	byID[id] = nt
	tunFDs[id] = t
	mu.Unlock()
	return id, nil
}

// Start brings up a nested (multi-hop) WireGuard tunnel over the supplied
// VpnService tun file descriptor. `clientPriv` is the client's WireGuard private
// key (base64), shared by both hops. Returns a handle for Stop, or an error
// (surfaced to Kotlin as an exception).
func Start(
	clientPriv,
	entryPub, entryIP, entryAssigned,
	exitPub, exitIP, exitAssigned string,
	tunFd int,
) (int64, error) {
	innerTun, err := tunFromFD(tunFd, nestedTunMTU)
	if err != nil {
		return 0, fmt.Errorf("wrap tun fd: %w", err)
	}
	entryAddr, err := netip.ParseAddr(entryIP)
	if err != nil {
		innerTun.Close()
		return 0, fmt.Errorf("entry ip: %w", err)
	}
	entryAssignedAddr, err := netip.ParseAddr(entryAssigned)
	if err != nil {
		innerTun.Close()
		return 0, fmt.Errorf("entry assigned: %w", err)
	}
	exitAddr, err := netip.ParseAddr(exitIP)
	if err != nil {
		innerTun.Close()
		return 0, fmt.Errorf("exit ip: %w", err)
	}
	exitAssignedAddr, err := netip.ParseAddr(exitAssigned)
	if err != nil {
		innerTun.Close()
		return 0, fmt.Errorf("exit assigned: %w", err)
	}

	t, err := wgnest.Start(
		clientPriv,
		wgnest.Gateway{PubKeyB64: entryPub, IP: entryAddr, AssignedIP: entryAssignedAddr},
		wgnest.Gateway{PubKeyB64: exitPub, IP: exitAddr, AssignedIP: exitAssignedAddr},
		innerTun,
		device.LogLevelError,
	)
	if err != nil {
		return 0, err
	}

	mu.Lock()
	nextID++
	id := nextID
	byID[id] = t
	tunFDs[id] = innerTun
	mu.Unlock()
	return id, nil
}

// Stop tears down the tunnel identified by handle. Safe to call twice.
func Stop(handle int64) {
	mu.Lock()
	t := byID[handle]
	delete(byID, handle)
	delete(tunFDs, handle)
	mu.Unlock()
	if t != nil {
		t.Close()
	}
}

// GetStats returns the tunnel's live counters as the CSV string
// "rxBytes,txBytes,lastHandshakeSec" (or "0,0,0" for an unknown/closed handle).
// A CSV keeps the gomobile surface to a plain string — no struct binding — and
// the caller (Kotlin/Swift) splits it. The values come from the inner device,
// which carries all real traffic, so they are the user-visible totals.
func GetStats(handle int64) string {
	mu.Lock()
	t := byID[handle]
	mu.Unlock()
	if t == nil {
		return "0,0,0"
	}
	rx, tx, hs := t.Stats()
	return fmt.Sprintf("%d,%d,%d", rx, tx, hs)
}
