module github.com/runonflux/cumulusvpn-gateway

go 1.25.0

require (
	github.com/amnezia-vpn/amneziawg-go v0.2.19
	golang.org/x/crypto v0.54.0
	golang.org/x/net v0.57.0
	golang.org/x/time v0.15.0
	gvisor.dev/gvisor v0.0.0-20231202080848-1f7806d17489
)

require (
	github.com/google/btree v1.1.3 // indirect
	golang.org/x/sys v0.47.0 // indirect
	golang.zx2c4.com/wintun v0.0.0-20230126152724-0fa3db229ce2 // indirect
)

// ENGINE: we use AmneziaWG (github.com/amnezia-vpn/amneziawg-go), a fork of
// wireguard-go whose cryptography is byte-identical to upstream WireGuard but
// which adds DPI-obfuscation params (jc/jmin/jmax/s1/s2/h1-h4). A vanilla device
// (no params) is wire-compatible with stock WireGuard clients, so the single
// engine serves both the vanilla and obfuscated listeners (docs/15-transports.md).
//
// gvisor MUST match the version amneziawg-go pins, so there is a single gvisor
// copy and the tcpip types line up between the vendored netstack tun and the
// forwarder. We hold the AWG-1.5 line (v0.2.x → gvisor 20231202): the AWG-2.0
// line (v1.x) drags gvisor to 20250606, whose stack.PacketBuffer dropped IsNil()
// and breaks internal/netstack/tun.go. Bump amneziawg-go and gvisor together,
// never alone; a 2.0 upgrade is a coordinated netstack re-vendor.
