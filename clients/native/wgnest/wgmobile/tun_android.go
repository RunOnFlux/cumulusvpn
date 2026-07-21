//go:build android

package wgmobile

import "golang.zx2c4.com/wireguard/tun"

// tunFromFD wraps the Android VpnService tun fd. CreateUnmonitoredTUNFromFD is
// the canonical Android path (no netlink route monitoring, bare-IP framing) and
// reads the MTU from the fd itself, so `mtu` is ignored here (it's the iOS knob).
func tunFromFD(fd int, _ int) (tun.Device, error) {
	dev, _, err := tun.CreateUnmonitoredTUNFromFD(fd)
	return dev, err
}
