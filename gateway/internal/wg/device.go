// Package wg owns the userspace data plane: a wireguard-go device bound to an
// ordinary UDP socket, backed by a gVisor netstack TUN (no /dev/net/tun, no
// NET_ADMIN — the whole point, see docs/03-gateway.md).
package wg

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"log"
	"net/netip"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

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
	// seen is when each peer last completed a handshake, refreshed from the
	// device by TouchFromHandshakes. It is what idle eviction runs on — and it
	// must come from HANDSHAKES, not from enroll: a web-issued static .conf never
	// re-enrolls, so an enroll-driven clock would evict exactly the users the
	// peer cache exists to protect, while they were actively connected.
	seen map[string]time.Time

	// cachePath, when set, persists the peer table across restarts
	// (peercache.go). Only ONE device should own it — the allocation authority,
	// whose table the others mirror — or they would race to rewrite the same
	// file. cacheMu serializes writers so a slow write can't interleave with a
	// newer one and land stale content.
	cachePath string
	cacheMu   sync.Mutex
	// cacheFailed/cacheWarned track write health so an unwritable /data is
	// reported once (and via PersistHealthy) rather than once per enroll.
	cacheFailed bool
	cacheWarned bool
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
	key, err := LoadOrGenerateKey(keyFile)
	if err != nil {
		return nil, err
	}
	return NewWithKey(listenPort, key)
}

// NewObfuscated is New plus the AmneziaWG obfuscation profile applied to the
// device, for the DPI-resistant listener. It loads the SAME keyFile as the
// vanilla device (one server identity, one enrollment serves both transports);
// only the listen port and the obfuscation framing differ.
func NewObfuscated(listenPort int, keyFile string, p ObfsParams) (*Device, error) {
	key, err := LoadOrGenerateKey(keyFile)
	if err != nil {
		return nil, err
	}
	return NewObfuscatedWithKey(listenPort, key, p)
}

// NewWithKey builds a vanilla device from an ALREADY-LOADED key. Use this when
// one process runs several devices (vanilla + obfuscated) that must share the
// same server identity: load the key ONCE with LoadOrGenerateKey and hand the
// same bytes to each device, so they can never diverge — which would silently
// break the obfs transport (clients pin the vanilla pubkey) if the key file is
// unwritable and each device generated its own random key.
func NewWithKey(listenPort int, key [32]byte) (*Device, error) {
	return newDevice(listenPort, key, "")
}

// NewObfuscatedWithKey is NewWithKey plus the AmneziaWG obfuscation profile.
func NewObfuscatedWithKey(listenPort int, key [32]byte, p ObfsParams) (*Device, error) {
	return newDevice(listenPort, key, p.UAPI())
}

// newDevice is the shared constructor; priv is the already-loaded server key and
// extraUAPI appends transport-specific settings (empty for vanilla, the
// obfuscation lines for the obfs listener).
func newDevice(listenPort int, priv [32]byte, extraUAPI string) (*Device, error) {
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
		seen:   make(map[string]time.Time),
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
	prior, existed := d.byKey[pubkey]
	d.byKey[pubkey] = allowedIP
	d.byAddr[allowedIP] = pubkey
	if _, stamped := d.seen[pubkey]; !stamped {
		// Stamp on first registration so a peer that enrolls and never connects
		// still ages out; handshakes refresh it from here on.
		d.seen[pubkey] = time.Now()
	}
	d.mu.Unlock()
	// A re-enroll of an unchanged peer is the common case (every app reconnect
	// hits enroll), and it changes nothing on disk — skip the whole-file rewrite
	// and fsync, which would otherwise run inside the API's global enroll lock.
	if !existed || prior != allowedIP {
		d.persist()
	}
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
	_, existed := d.byKey[pubkey]
	if addr, ok := d.byKey[pubkey]; ok {
		delete(d.byAddr, addr)
		delete(d.byKey, pubkey)
	}
	delete(d.seen, pubkey)
	d.mu.Unlock()
	if existed {
		d.persist()
	}
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

// RestorePeers re-registers previously enrolled peers (from LoadPeerCache) and
// reports how many were restored. Call it BEFORE SetPeerCache: restoring is not
// a change worth writing back, and persisting per record would rewrite the file
// once per peer for no gain.
//
// A record that fails to register is skipped rather than fatal — one bad entry
// must not cost every other peer their enrollment.
func (d *Device) RestorePeers(recs []PeerRecord) int {
	n := 0
	for _, r := range recs {
		if err := d.AddPeer(r.PubKey, r.Addr); err != nil {
			log.Printf("wg: could not restore peer %s: %v", shortKey(r.PubKey), err)
			continue
		}
		// Carry the stamp forward, or the first eviction sweep would treat every
		// restored peer as freshly seen and never age any of them out.
		if !r.Seen.IsZero() {
			d.mu.Lock()
			d.seen[r.PubKey] = r.Seen
			d.mu.Unlock()
		}
		n++
	}
	return n
}

// SetPeerCache makes this device persist its peer table to path on every change.
// Set it on the allocation authority only (see cachePath).
//
// It deliberately does NOT write on the way in. At this moment the file on disk
// is the authority and nothing has changed, so a write could only ever replace
// it with a table derived from it — which is harmless after a clean load and
// destructive after a partial one. Callers must skip this entirely when
// LoadPeerCache reported the load was not clean.
func (d *Device) SetPeerCache(path string) {
	d.mu.Lock()
	d.cachePath = path
	d.mu.Unlock()
}

// TouchFromHandshakes refreshes each peer's last-seen stamp from the device's
// own handshake clock and persists the result. This is what keeps an ACTIVE peer
// from being evicted: enrollment is a one-time event for a web-issued .conf, but
// handshakes continue for as long as the tunnel is used.
//
// Returns the number of peers whose stamp advanced.
func (d *Device) TouchFromHandshakes() int {
	hs, err := d.LastHandshakes()
	if err != nil {
		log.Printf("wg: could not read handshake times: %v", err)
		return 0
	}
	n := 0
	d.mu.Lock()
	for pk, t := range hs {
		if _, enrolled := d.byKey[pk]; !enrolled {
			continue
		}
		if t.After(d.seen[pk]) {
			d.seen[pk] = t
			n++
		}
	}
	d.mu.Unlock()
	if n > 0 {
		d.persist()
	}
	return n
}

// PeerRecords snapshots the peer table with last-seen stamps, for callers that
// need to decide what to evict.
func (d *Device) PeerRecords() []PeerRecord {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return d.snapshotLocked()
}

// snapshotLocked builds the record list. Caller holds at least a read lock.
func (d *Device) snapshotLocked() []PeerRecord {
	out := make([]PeerRecord, 0, len(d.byKey))
	for pk, addr := range d.byKey {
		out = append(out, PeerRecord{PubKey: pk, Addr: addr, Seen: d.seen[pk]})
	}
	return out
}

// LastHandshakes reports the last successful handshake per peer, from the
// WireGuard device itself. Peers that have never handshaked are omitted.
func (d *Device) LastHandshakes() (map[string]time.Time, error) {
	dump, err := d.dev.IpcGet()
	if err != nil {
		return nil, err
	}
	out := make(map[string]time.Time)
	var cur string
	for _, line := range strings.Split(dump, "\n") {
		key, val, ok := strings.Cut(strings.TrimSpace(line), "=")
		if !ok {
			continue
		}
		switch key {
		case "public_key":
			cur = ""
			raw, err := hex.DecodeString(val)
			if err == nil && len(raw) == 32 {
				cur = base64.StdEncoding.EncodeToString(raw)
			}
		case "last_handshake_time_sec":
			if cur == "" {
				continue
			}
			secs, err := strconv.ParseInt(val, 10, 64)
			if err == nil && secs > 0 {
				out[cur] = time.Unix(secs, 0)
			}
		}
	}
	return out, nil
}

// persist snapshots the peer table and writes it out. A no-op unless a cache
// path is set. Failures are logged (rate-limited — an unwritable /data would
// otherwise log once per enroll forever) and swallowed: losing persistence
// degrades to the old in-memory behaviour, which is not worth failing an enroll
// the client would otherwise complete.
func (d *Device) persist() {
	// Take the writer lock FIRST, then snapshot. Snapshotting before serializing
	// lets two writers interleave — the one that read older state could win the
	// rename and leave the file behind the in-memory truth.
	d.cacheMu.Lock()
	defer d.cacheMu.Unlock()

	d.mu.RLock()
	path := d.cachePath
	var recs []PeerRecord
	if path != "" {
		recs = d.snapshotLocked()
	}
	d.mu.RUnlock()
	if path == "" {
		return
	}

	err := savePeerCache(path, recs)
	d.cacheFailed, d.cacheWarned = err != nil, d.cacheWarned && err != nil
	if err != nil && !d.cacheWarned {
		d.cacheWarned = true
		log.Printf("wg: WARNING: could not persist peer cache %s (%v); enrollments will not survive a "+
			"restart, and this will not be logged again until a write succeeds", path, err)
	}
	if err == nil {
		d.cacheWarned = false
	}
}

// PersistHealthy reports whether enrollments on this device will actually
// survive a restart, so the control API can surface a node that silently
// reverted to the old throw-everything-away behaviour instead of letting it look
// identical to a healthy one.
//
// False covers BOTH ways that happens, which is the point: the last write
// failed (an unwritable or full /data), or persistence was never enabled at all
// — main.go deliberately skips it for a boot when the cache could not be read
// cleanly. Reporting "healthy" for a node that isn't persisting because nobody
// asked it to would defeat the whole check.
func (d *Device) PersistHealthy() bool {
	d.mu.RLock()
	enabled := d.cachePath != ""
	d.mu.RUnlock()
	if !enabled {
		return false
	}
	d.cacheMu.Lock()
	defer d.cacheMu.Unlock()
	return !d.cacheFailed
}

// shortKey abbreviates a pubkey for logs — never log a full key.
func shortKey(pubkey string) string {
	if len(pubkey) <= 8 {
		return "…"
	}
	return pubkey[:8] + "…"
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

// LoadOrGenerateKey loads the base64 server key from path, or generates and
// persists a new one if the file is absent. Persistence failure is non-fatal
// (an ephemeral identity still works — clients just re-enroll after a restart),
// but callers that run multiple devices MUST load the key ONCE and share it (see
// NewWithKey): letting each device call this independently on an unwritable path
// would hand each a DIFFERENT random key.
func LoadOrGenerateKey(path string) ([32]byte, error) {
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
		// Non-fatal: the process keeps this in-memory key (shared across devices
		// by the caller), so the identity is stable for this run; it just isn't
		// persisted across restarts.
		log.Printf("wg: WARNING: could not persist key file %s (%v); identity is ephemeral this run", path, err)
	}
	return key, nil
}
