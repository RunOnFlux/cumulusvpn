//go:build ios

package wgmobile

import (
	"os"

	"golang.zx2c4.com/wireguard/tun"
)

// innerMTU is the inner tun's MTU: the OS tun carries app traffic that gets two
// stacked WireGuard headers, so it must leave room for both. Matches the
// NEPacketTunnelNetworkSettings MTU set on the Swift side and docs/11-multihop.
const innerMTU = 1340

// tunFromFD wraps the iOS NEPacketTunnelFlow utun fd (obtained on the Swift side
// via the same KVC trick WireGuardKit uses). On Darwin the tun reads/writes with
// the 4-byte utun protocol header; CreateTUNFromFile handles that framing.
func tunFromFD(fd int) (tun.Device, error) {
	file := os.NewFile(uintptr(fd), "utun")
	return tun.CreateTUNFromFile(file, innerMTU)
}
