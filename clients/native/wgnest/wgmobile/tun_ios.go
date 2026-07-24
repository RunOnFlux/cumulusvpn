//go:build ios

package wgmobile

import (
	"os"

	"golang.org/x/sys/unix"
	"github.com/amnezia-vpn/amneziawg-go/tun"
)

// tunFromFD wraps the iOS NEPacketTunnelFlow utun fd (found on the Swift side via
// the same getpeername scan WireGuardKit uses). It mirrors WireGuardKit's
// api-apple.go exactly:
//   - DUP the fd — CreateTUNFromFile's os.File takes ownership, so dup'ing keeps
//     the NE runtime's original fd intact.
//   - pass MTU 0 — so wireguard-go does NOT call setMTU, whose ioctl is blocked
//     in the NE sandbox ("failed to set MTU on utunN: operation not permitted").
//     iOS sets the tun MTU via NEPacketTunnelNetworkSettings.mtu on the Swift
//     side, so the `mtu` arg here is unused.
func tunFromFD(fd int, _ int) (tun.Device, error) {
	dup, err := unix.Dup(fd)
	if err != nil {
		return nil, err
	}
	return tun.CreateTUNFromFile(os.NewFile(uintptr(dup), "/dev/tun"), 0)
}
