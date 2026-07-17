module github.com/runonflux/cumulusvpn-gateway

go 1.25.0

require (
	golang.org/x/crypto v0.54.0
	golang.org/x/net v0.57.0
	golang.org/x/time v0.8.0
	golang.zx2c4.com/wireguard v0.0.0-20231211153847-12269c276173
	gvisor.dev/gvisor v0.0.0-20230927004350-cbd86285d259
)

require (
	github.com/google/btree v1.0.1 // indirect
	golang.org/x/sys v0.47.0 // indirect
	golang.zx2c4.com/wintun v0.0.0-20230126152724-0fa3db229ce2 // indirect
)

// wireguard-go ships as a pseudo-version that transitively pins a specific
// gvisor pseudo-version; gvisor must match it so there is a single gvisor copy
// and the tcpip types line up between the vendored netstack tun and the
// forwarder. This pin is a deliberate constraint, not staleness: bumping
// wireguard-go to its latest pseudo-version (v0.0.0-20260522210424-ecfc5a8d5446)
// drags gvisor to v0.0.0-20250503011706-..., whose stack.PacketBuffer dropped
// IsNil() and breaks internal/netstack/tun.go — so wireguard-go and gvisor are
// held at the last mutually-compatible pair. Revisit together, never alone.
