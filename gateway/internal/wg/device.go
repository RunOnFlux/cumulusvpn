// Package wg owns the userspace data plane: a wireguard-go device bound to an
// ordinary UDP socket, backed by a gVisor netstack TUN (no /dev/net/tun, no
// NET_ADMIN — the whole point, see docs/03-gateway.md).
package wg

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"net/netip"
	"os"
	"sync"

	"github.com/amnezia-vpn/amneziawg-go/conn"
	"github.com/amnezia-vpn/amneziawg-go/device"
	"golang.org/x/crypto/curve25519"

	"github.com/runonflux/cumulusvpn-gateway/internal/netstack"

	"gvisor.dev/gvisor/pkg/tcpip/stack"
)

const (
	// GatewayIP is the gateway's own address inside every tunnel.
	GatewayIP = "10.8.0.1"
	// MTU leaves room for the WireGuard envelope inside a 1500-byte path.
	MTU = 1420
)

// Device wraps the wireguard-go device, the netstack it feeds, and the
// in-memory peer table (pubkey <-> assigned 10.8.x.y address).
type Device struct {
	dev  *device.Device
	tnet *netstack.Net

	priv [32]byte
	pub  [32]byte

	mu     sync.RWMutex
	byKey  map[string]netip.Addr // pubkey (base64) -> assigned IP
	byAddr map[netip.Addr]string // assigned IP -> pubkey (base64)
}

// ObfsParams is the AmneziaWG obfuscation profile (docs/15-transports.md). The
// zero value is vanilla WireGuard (no obfuscation). Every field MUST match on
// the client for the handshake to complete, so the gateway advertises the
// profile in /v1/info transports[].params. Jc/Jmin/Jmax control junk packets;
// S1/S2 the handshake-header junk; H1..H4 the custom message-type magic (must be
// distinct and outside the reserved 1..4). None of this alters the WireGuard
// cryptography — it only reshapes the framing so the handshake loses the fixed
// 148/92-byte fingerprint.
type ObfsParams struct {
	Jc, Jmin, Jmax int
	S1, S2         int
	H1, H2, H3, H4 uint32
}

// UAPI renders the obfuscation settings as device-level UAPI lines. They belong
// in the interface section (before any public_key= peer line) both here and in
// the client's [Interface] block.
func (p ObfsParams) UAPI() string {
	return fmt.Sprintf(
		"jc=%d\njmin=%d\njmax=%d\ns1=%d\ns2=%d\nh1=%d\nh2=%d\nh3=%d\nh4=%d\n",
		p.Jc, p.Jmin, p.Jmax, p.S1, p.S2, p.H1, p.H2, p.H3, p.H4,
	)
}

// Map renders the profile as the string params advertised in /v1/info, so the
// client can build a matching config.
func (p ObfsParams) Map() map[string]string {
	u32 := func(v uint32) string { return fmt.Sprintf("%d", v) }
	return map[string]string{
		"jc":   fmt.Sprintf("%d", p.Jc),
		"jmin": fmt.Sprintf("%d", p.Jmin),
		"jmax": fmt.Sprintf("%d", p.Jmax),
		"s1":   fmt.Sprintf("%d", p.S1),
		"s2":   fmt.Sprintf("%d", p.S2),
		"h1":   u32(p.H1),
		"h2":   u32(p.H2),
		"h3":   u32(p.H3),
		"h4":   u32(p.H4),
	}
}

// DefaultObfsParams is the fleet-wide AmneziaWG-1.5 obfuscation profile ("v1").
// Gateway and client must agree; the gateway advertises it in /v1/info so the
// client applies a matching config. A single fixed profile is fine for a first
// release (it defeats the vanilla-WG fingerprint); per-gateway/rotating profiles
// are a later refinement (docs/15-transports.md). H1..H4 are distinct and well
// outside the reserved 1..4 message types.
var DefaultObfsParams = ObfsParams{
	Jc:   4,
	Jmin: 40,
	Jmax: 70,
	S1:   50,
	S2:   100,
	H1:   1148746654,
	H2:   1148746655,
	H3:   1148746656,
	H4:   1148746657,
}

// New creates the netstack TUN, brings up a VANILLA WireGuard device on
// listenPort, and loads (or generates and persists) the server keypair from
// keyFile. Wire-identical to upstream WireGuard (no obfuscation).
func New(listenPort int, keyFile string) (*Device, error) {
	return newDevice(listenPort, keyFile, "")
}

// NewObfuscated is New plus the AmneziaWG obfuscation profile applied to the
// device, for the DPI-resistant listener. It loads the SAME keyFile as the
// vanilla device (one server identity, one enrollment serves both transports);
// only the listen port and the obfuscation framing differ.
func NewObfuscated(listenPort int, keyFile string, p ObfsParams) (*Device, error) {
	return newDevice(listenPort, keyFile, p.UAPI())
}

// newDevice is the shared constructor; extraUAPI appends transport-specific
// settings (empty for vanilla, the obfuscation lines for the obfs listener).
func newDevice(listenPort int, keyFile string, extraUAPI string) (*Device, error) {
	priv, err := loadOrGenerateKey(keyFile)
	if err != nil {
		return nil, err
	}

	gwAddr := netip.MustParseAddr(GatewayIP)
	// The DNS address handed to netstack here only matters for the
	// gateway's own outbound lookups through the stack (none in v1);
	// client DNS is a normal forwarded flow to the DNS IP we advertise.
	tunDev, tnet, err := netstack.CreateNetTUN(
		[]netip.Addr{gwAddr},
		[]netip.Addr{gwAddr},
		MTU,
	)
	if err != nil {
		return nil, fmt.Errorf("wg: create netstack tun: %w", err)
	}

	// conn.NewDefaultBind = ordinary UDP socket, no privileges needed.
	logger := device.NewLogger(device.LogLevelError, "wg ")
	dev := device.NewDevice(tunDev, conn.NewDefaultBind(), logger)

	// Configure via UAPI: hex-encoded keys, one setting per line. extraUAPI
	// carries the obfuscation profile for an obfs device (empty for vanilla).
	uapi := fmt.Sprintf("private_key=%s\nlisten_port=%d\n", hex.EncodeToString(priv[:]), listenPort) + extraUAPI
	if err := dev.IpcSet(uapi); err != nil {
		dev.Close()
		return nil, fmt.Errorf("wg: IpcSet: %w", err)
	}
	if err := dev.Up(); err != nil {
		dev.Close()
		return nil, fmt.Errorf("wg: device up: %w", err)
	}

	d := &Device{
		dev:    dev,
		tnet:   tnet,
		priv:   priv,
		byKey:  make(map[string]netip.Addr),
		byAddr: make(map[netip.Addr]string),
	}
	curve25519.ScalarBaseMult(&d.pub, &d.priv)
	return d, nil
}

// PublicKey returns the server WireGuard public key, base64-encoded.
func (d *Device) PublicKey() string {
	return base64.StdEncoding.EncodeToString(d.pub[:])
}

// PrivateKey exposes the raw private key for the API response signer.
// POC: keep this out of any logs; consider deriving the signing key here
// instead of exporting the raw scalar.
func (d *Device) PrivateKey() [32]byte {
	return d.priv
}

// Net returns the netstack Net handle (dialers/listeners on the stack).
func (d *Device) Net() *netstack.Net {
	return d.tnet
}

// Stack returns the gVisor *stack.Stack underlying the netstack TUN, needed
// by the forwarder to register TCP/UDP forwarders and enable promiscuous
// mode.
//
// Upstream golang.zx2c4.com/wireguard/tun/netstack does NOT export the stack
// field on its Net type, so we vendor that single file into
// internal/netstack and add the Stack() accessor there — the standard
// tun2socks move. Everything else in this package uses only exported API.
func (d *Device) Stack() *stack.Stack {
	return d.tnet.Stack()
}

// AddPeer registers a client pubkey (base64, 32 bytes) with its assigned
// tunnel address as the only allowed IP (spoofing protection: the device
// drops decrypted packets whose source is not the peer's allowed IP).
func (d *Device) AddPeer(pubkey string, allowedIP netip.Addr) error {
	raw, err := decodeKey(pubkey)
	if err != nil {
		return err
	}
	uapi := fmt.Sprintf("public_key=%s\nallowed_ip=%s/32\n", hex.EncodeToString(raw), allowedIP)
	if err := d.dev.IpcSet(uapi); err != nil {
		return fmt.Errorf("wg: add peer: %w", err)
	}
	d.mu.Lock()
	d.byKey[pubkey] = allowedIP
	d.byAddr[allowedIP] = pubkey
	d.mu.Unlock()
	return nil
}

// RemovePeer drops a peer from the device and the address maps.
func (d *Device) RemovePeer(pubkey string) error {
	raw, err := decodeKey(pubkey)
	if err != nil {
		return err
	}
	uapi := fmt.Sprintf("public_key=%s\nremove=true\n", hex.EncodeToString(raw))
	if err := d.dev.IpcSet(uapi); err != nil {
		return fmt.Errorf("wg: remove peer: %w", err)
	}
	d.mu.Lock()
	if addr, ok := d.byKey[pubkey]; ok {
		delete(d.byAddr, addr)
		delete(d.byKey, pubkey)
	}
	d.mu.Unlock()
	return nil
}

// PeerByAddr maps a tunnel source address back to the peer pubkey. The
// forwarder uses this to pick the right rate limiter for a flow.
func (d *Device) PeerByAddr(addr netip.Addr) (string, bool) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	pk, ok := d.byAddr[addr]
	return pk, ok
}

// PeerAddr returns the assigned tunnel address for a pubkey, if enrolled.
func (d *Device) PeerAddr(pubkey string) (netip.Addr, bool) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	a, ok := d.byKey[pubkey]
	return a, ok
}

// PeerCount returns the number of enrolled peers.
func (d *Device) PeerCount() int {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return len(d.byKey)
}

// Peers returns a snapshot of enrolled pubkeys (for the tier-sync loop).
func (d *Device) Peers() []string {
	d.mu.RLock()
	defer d.mu.RUnlock()
	out := make([]string, 0, len(d.byKey))
	for pk := range d.byKey {
		out = append(out, pk)
	}
	return out
}

// Close shuts the WireGuard device down.
func (d *Device) Close() {
	d.dev.Close()
}

// decodeKey validates and decodes a base64 WireGuard key.
func decodeKey(b64 string) ([]byte, error) {
	raw, err := base64.StdEncoding.DecodeString(b64)
	if err != nil || len(raw) != 32 {
		return nil, fmt.Errorf("wg: invalid key %q", b64)
	}
	return raw, nil
}

// loadOrGenerateKey reads a persisted private key or creates a new one.
// POC: also persist the peer table to /data/peers.cache (pubkey, assigned
// IP, paid_until) so restarts are seamless; losing it is fine — clients
// auto-re-enroll (docs/03-gateway.md "Peer management").
func loadOrGenerateKey(path string) ([32]byte, error) {
	var key [32]byte
	if raw, err := os.ReadFile(path); err == nil {
		dec, err := base64.StdEncoding.DecodeString(string(raw))
		if err == nil && len(dec) == 32 {
			copy(key[:], dec)
			return key, nil
		}
		return key, fmt.Errorf("wg: corrupt key file %s", path)
	}
	if _, err := rand.Read(key[:]); err != nil {
		return key, err
	}
	// Curve25519 clamping per the WireGuard spec.
	key[0] &= 248
	key[31] &= 127
	key[31] |= 64
	if err := os.WriteFile(path, []byte(base64.StdEncoding.EncodeToString(key[:])), 0o600); err != nil {
		// Non-fatal: ephemeral identity still works, clients just
		// re-enroll after a restart. POC: log a warning.
		_ = err
	}
	return key, nil
}
