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

var (
	mu      sync.Mutex
	byID    = map[int64]*wgnest.NestedTunnel{}
	nextID  int64
	tunFDs  = map[int64]tun.Device{}
)

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
	innerTun, err := tunFromFD(tunFd)
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
