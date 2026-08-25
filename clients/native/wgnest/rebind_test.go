package wgnest

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"testing"
	"time"

	"github.com/amnezia-vpn/amneziawg-go/conn"
	"github.com/amnezia-vpn/amneziawg-go/device"
	"github.com/amnezia-vpn/amneziawg-go/tun/netstack"
	"golang.org/x/crypto/curve25519"
)

// keypair returns (privB64, pubB64) for a fresh Curve25519 WireGuard key.
func keypair(t *testing.T) (string, string) {
	t.Helper()
	var priv [32]byte
	if _, err := rand.Read(priv[:]); err != nil {
		t.Fatalf("rand: %v", err)
	}
	priv[0] &= 248
	priv[31] = (priv[31] & 127) | 64
	pub, err := curve25519.X25519(priv[:], curve25519.Basepoint)
	if err != nil {
		t.Fatalf("x25519: %v", err)
	}
	return base64.StdEncoding.EncodeToString(priv[:]), base64.StdEncoding.EncodeToString(pub)
}

func hexOf(t *testing.T, b64 string) string {
	t.Helper()
	raw, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		t.Fatalf("decode key: %v", err)
	}
	return hex.EncodeToString(raw)
}

// listenPort reads the port a device actually bound, after Up.
func listenPort(t *testing.T, d *device.Device) int {
	t.Helper()
	get, err := d.IpcGet()
	if err != nil {
		t.Fatalf("IpcGet: %v", err)
	}
	for _, line := range strings.Split(get, "\n") {
		if key, val, ok := strings.Cut(line, "="); ok && key == "listen_port" {
			var p int
			if _, err := fmt.Sscanf(val, "%d", &p); err == nil && p != 0 {
				return p
			}
		}
	}
	t.Fatal("device reported no listen_port")
	return 0
}

// peerServer stands in for a gateway: a wireguard-go device on a netstack,
// serving HTTP inside the tunnel so the client can prove real round-trips.
func peerServer(t *testing.T, serverPrivB64, clientPubB64 string, serverIP, clientIP netip.Addr, body string) int {
	t.Helper()
	tun, tnet, err := netstack.CreateNetTUN([]netip.Addr{serverIP}, []netip.Addr{serverIP}, 1420)
	if err != nil {
		t.Fatalf("server netstack: %v", err)
	}
	// Same reason as nest.go: netstack queues an EventUp that NewDevice's reader
	// would turn into an Up() racing the IpcSet below.
	drainPendingUp(tun)
	dev := device.NewDevice(tun, conn.NewDefaultBind(), device.NewLogger(device.LogLevelError, "srv "))
	t.Cleanup(dev.Close)
	// NO listen_port here, deliberately. Setting it makes handleDeviceLine call
	// BindUpdate in the MIDDLE of the IpcSet (uapi.go:284), which starts receive
	// goroutines that read device.headers.* while the same operation is still
	// writing those fields in mergeWithDevice (uapi.go:737) — an unsynchronised
	// read/write inside amneziawg-go that the race detector rightly flags.
	// Up() binds too (upLocked -> BindUpdate), by which point the merge is done,
	// so leaving the port out gets an ephemeral port with no race.
	cfg := fmt.Sprintf(
		"private_key=%s\npublic_key=%s\nallowed_ip=%s/32\n",
		hexOf(t, serverPrivB64), hexOf(t, clientPubB64), clientIP,
	)
	if err := dev.IpcSet(cfg); err != nil {
		t.Fatalf("server IpcSet: %v", err)
	}
	if err := dev.Up(); err != nil {
		t.Fatalf("server Up: %v", err)
	}

	ln, err := tnet.ListenTCP(&net.TCPAddr{IP: serverIP.AsSlice(), Port: 80})
	if err != nil {
		t.Fatalf("server listen: %v", err)
	}
	t.Cleanup(func() { _ = ln.Close() })
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, body)
	})}
	go func() { _ = srv.Serve(ln) }()
	t.Cleanup(func() { _ = srv.Close() })

	return listenPort(t, dev)
}

// fetch GETs through the client's netstack, retrying to absorb handshake
// latency. Returns the body, or fails the test at the deadline.
func fetch(t *testing.T, tnet *netstack.Net, url string, within time.Duration) string {
	t.Helper()
	hc := &http.Client{
		Timeout:   3 * time.Second,
		Transport: &http.Transport{DialContext: tnet.DialContext},
	}
	deadline := time.Now().Add(within)
	var lastErr error
	for time.Now().Before(deadline) {
		resp, err := hc.Get(url)
		if err != nil {
			lastErr = err
			time.Sleep(100 * time.Millisecond)
			continue
		}
		b, _ := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		return string(b)
	}
	t.Fatalf("no traffic through the tunnel within %s: %v", within, lastErr)
	return ""
}

// TestRebindKeepsTheSessionAlive is the property the whole roaming fix rests
// on: BindUpdate closes and reopens the UDP socket UNDER a live WireGuard
// session, and the session must survive it. If a rebind cost a rehandshake —
// or worse, wedged the device — calling it from a network-change callback
// would be a downgrade on every roam.
func TestRebindKeepsTheSessionAlive(t *testing.T) {
	serverIP := netip.MustParseAddr("10.9.0.1")
	clientIP := netip.MustParseAddr("10.9.0.2")
	const body = "through-the-tunnel"

	serverPriv, serverPub := keypair(t)
	clientPriv, clientPub := keypair(t)

	port := peerServer(t, serverPriv, clientPub, serverIP, clientIP, body)

	clientTun, clientNet, err := netstack.CreateNetTUN(
		[]netip.Addr{clientIP}, []netip.Addr{serverIP}, 1420)
	if err != nil {
		t.Fatalf("client netstack: %v", err)
	}
	tunnel, err := StartSingle(clientPriv, Gateway{
		PubKeyB64: serverPub,
		IP:        netip.MustParseAddr("127.0.0.1"),
		Port:      port,
	}, clientTun, device.LogLevelError)
	if err != nil {
		t.Fatalf("StartSingle: %v", err)
	}
	t.Cleanup(tunnel.Close)

	url := fmt.Sprintf("http://%s/", serverIP)
	if got := fetch(t, clientNet, url, 15*time.Second); got != body {
		t.Fatalf("before rebind: body = %q, want %q", got, body)
	}

	if err := tunnel.Rebind(); err != nil {
		t.Fatalf("Rebind: %v", err)
	}

	// The socket is new; the peer's cached source address was cleared. Traffic
	// must resume without the caller re-establishing anything.
	if got := fetch(t, clientNet, url, 15*time.Second); got != body {
		t.Fatalf("after rebind: body = %q, want %q", got, body)
	}
}

// TestRebindIsIdempotent — a phone changing networks can fire several callbacks
// in a row (lost Wi-Fi, gained cellular, capabilities changed). Each one calls
// Rebind, so repeated calls must be harmless rather than cumulative.
func TestRebindIsIdempotent(t *testing.T) {
	serverIP := netip.MustParseAddr("10.9.1.1")
	clientIP := netip.MustParseAddr("10.9.1.2")
	const body = "still-here"

	serverPriv, serverPub := keypair(t)
	clientPriv, clientPub := keypair(t)
	port := peerServer(t, serverPriv, clientPub, serverIP, clientIP, body)

	clientTun, clientNet, err := netstack.CreateNetTUN(
		[]netip.Addr{clientIP}, []netip.Addr{serverIP}, 1420)
	if err != nil {
		t.Fatalf("client netstack: %v", err)
	}
	tunnel, err := StartSingle(clientPriv, Gateway{
		PubKeyB64: serverPub,
		IP:        netip.MustParseAddr("127.0.0.1"),
		Port:      port,
	}, clientTun, device.LogLevelError)
	if err != nil {
		t.Fatalf("StartSingle: %v", err)
	}
	t.Cleanup(tunnel.Close)

	url := fmt.Sprintf("http://%s/", serverIP)
	if got := fetch(t, clientNet, url, 15*time.Second); got != body {
		t.Fatalf("initial: body = %q", got)
	}
	for i := range 5 {
		if err := tunnel.Rebind(); err != nil {
			t.Fatalf("Rebind #%d: %v", i+1, err)
		}
	}
	if got := fetch(t, clientNet, url, 15*time.Second); got != body {
		t.Fatalf("after 5 rebinds: body = %q, want %q", got, body)
	}
}

// TestRebindOnClosedTunnel — a network change can land after teardown. It must
// report, not panic.
func TestRebindOnClosedTunnel(t *testing.T) {
	var empty NestedTunnel
	if err := empty.Rebind(); err == nil {
		t.Fatal("Rebind on a tunnel with no devices should error")
	}
}
