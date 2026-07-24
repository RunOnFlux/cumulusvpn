package wg

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"testing"
	"time"

	"github.com/runonflux/cumulusvpn-gateway/internal/limiter"
	"github.com/runonflux/cumulusvpn-gateway/internal/netstack"

	"github.com/amnezia-vpn/amneziawg-go/conn"
	"github.com/amnezia-vpn/amneziawg-go/device"
	"golang.org/x/crypto/curve25519"
)

// TestTunnelDataPlaneEndToEnd is the guard for the crux of the product: a real
// WireGuard tunnel must actually carry traffic to the internet through the
// gVisor exit forwarder.
func TestTunnelDataPlaneEndToEnd(t *testing.T) {
	runTunnelDataPlaneE2E(t, nil)
}

// TestObfuscatedTunnelDataPlaneEndToEnd is the same guard for the AmneziaWG
// obfuscated transport: the gateway device and the client both apply the
// matching DefaultObfsParams (junk packets + reshaped headers), the handshake
// completes, and real traffic round-trips. Proves the obfuscated listener
// carries traffic — not merely that it builds — and that obfuscation is
// symmetric (both ends must agree on the profile).
func TestObfuscatedTunnelDataPlaneEndToEnd(t *testing.T) {
	p := DefaultObfsParams
	runTunnelDataPlaneE2E(t, &p)
}

// runTunnelDataPlaneE2E stands up an in-process gateway (WG device + netstack
// forwarder) and a client (userspace WG via netstack), does a real handshake
// over UDP loopback, and fetches an HTTP server through the tunnel — asserting
// the bytes round-trip. obfs==nil is vanilla WireGuard; non-nil applies the
// AmneziaWG obfuscation profile on BOTH the gateway device and the client.
//
// This specifically pins the netstack stack.Options{HandleLocal:false} decision:
// with HandleLocal=true, promiscuous-mode exit routing makes gVisor drop every
// forwarded packet as an "invalid source address" and this test times out. A
// future re-vendor of internal/netstack that reintroduces HandleLocal:true (the
// upstream wireguard-go default) would fail here instead of silently shipping a
// gateway that enrolls clients but tunnels nothing.
func runTunnelDataPlaneE2E(t *testing.T, obfs *ObfsParams) {
	// Origin server the client will reach *through* the tunnel. It must NOT be on
	// 127.0.0.0/8: the gateway netstack deliberately drops loopback destinations
	// (IsV4LoopbackAddress -> InvalidDestinationAddressesReceived), which stops a
	// tunnel client from reaching the gateway's own loopback services. So we bind
	// the origin to the host's routable LAN IP — still local, never leaves the
	// machine, but non-loopback so the forwarder will dial it.
	hip := hostIP(t)
	const want = "hello-through-the-tunnel"
	ln, err := net.Listen("tcp", net.JoinHostPort(hip, "0"))
	if err != nil {
		t.Skipf("cannot listen on host IP %s: %v", hip, err)
	}
	origin := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, want)
	}))
	origin.Listener.Close()
	origin.Listener = ln
	origin.Start()
	defer origin.Close()

	// --- gateway (vanilla or obfuscated, same server identity path) ---
	port := freeUDPPort(t)
	key := t.TempDir() + "/srv.key"
	var gw *Device
	if obfs != nil {
		gw, err = NewObfuscated(port, key, *obfs)
	} else {
		gw, err = New(port, key)
	}
	if err != nil {
		t.Fatalf("gateway New: %v", err)
	}
	t.Cleanup(gw.Close)

	fwd := NewForwarder(gw, limiter.New(100, 50), nil, true)
	if err := fwd.Start(); err != nil {
		t.Fatalf("forwarder Start: %v", err)
	}

	// --- client keypair, registered with the gateway (bypassing enroll HTTP;
	// this test targets the data plane, AddPeer is what enroll ultimately does) ---
	cpriv, cpub := genTestKeypair(t)
	clientIP := netip.MustParseAddr("10.8.0.2")
	if err := gw.AddPeer(cpub, clientIP); err != nil {
		t.Fatalf("AddPeer: %v", err)
	}

	// --- client userspace WG over netstack ---
	tun, tnet, err := netstack.CreateNetTUN(
		[]netip.Addr{clientIP},
		[]netip.Addr{netip.MustParseAddr(GatewayIP)},
		MTU,
	)
	if err != nil {
		t.Fatalf("client CreateNetTUN: %v", err)
	}
	cdev := device.NewDevice(tun, conn.NewDefaultBind(), device.NewLogger(device.LogLevelError, "c "))
	t.Cleanup(cdev.Close)
	// Interface section first (private key + any obfuscation profile), THEN the
	// peer: obfs params are device-level UAPI keys, so they must precede the
	// public_key= line that opens the peer section (same order the real client's
	// [Interface] block produces).
	cfg := fmt.Sprintf("private_key=%s\n", hexKey(t, cpriv))
	if obfs != nil {
		cfg += obfs.UAPI() // client must apply the SAME obfuscation profile as the gateway
	}
	cfg += fmt.Sprintf(
		"public_key=%s\nendpoint=127.0.0.1:%d\nallowed_ip=0.0.0.0/0\npersistent_keepalive_interval=1\n",
		hexKey(t, gw.PublicKey()), port,
	)
	if err := cdev.IpcSet(cfg); err != nil {
		t.Fatalf("client IpcSet: %v", err)
	}
	if err := cdev.Up(); err != nil {
		t.Fatalf("client Up: %v", err)
	}

	// --- fetch the origin through the tunnel ---
	hc := &http.Client{
		Timeout:   15 * time.Second,
		Transport: &http.Transport{DialContext: tnet.DialContext},
	}
	// Retry briefly to absorb WG handshake latency (first packets may drop while
	// the handshake completes).
	deadline := time.Now().Add(15 * time.Second)
	var lastErr error
	for time.Now().Before(deadline) {
		resp, err := hc.Get(origin.URL)
		if err != nil {
			lastErr = err
			time.Sleep(250 * time.Millisecond)
			continue
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("through tunnel: HTTP %d", resp.StatusCode)
		}
		if string(body) != want {
			t.Fatalf("through tunnel: body = %q, want %q", body, want)
		}
		return // success
	}
	t.Fatalf("tunnel never carried traffic within deadline: %v", lastErr)
}

// hostIP returns the machine's primary non-loopback IPv4 address (the source IP
// the kernel would use for outbound traffic). Skips the test if none is available
// (e.g. a fully offline sandbox), keeping it hermetic rather than flaky.
func hostIP(t *testing.T) string {
	t.Helper()
	c, err := net.Dial("udp", "8.8.8.8:80") // no packets sent; just resolves the source IP
	if err != nil {
		t.Skipf("no routable interface to pick a host IP: %v", err)
	}
	defer c.Close()
	ip := c.LocalAddr().(*net.UDPAddr).IP
	if ip == nil || ip.IsLoopback() || ip.To4() == nil {
		t.Skipf("host IP unusable for test (got %v)", ip)
	}
	return ip.String()
}

// freeUDPPort grabs an ephemeral UDP port and releases it for the caller to bind.
func freeUDPPort(t *testing.T) int {
	t.Helper()
	c, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatalf("freeUDPPort: %v", err)
	}
	port := c.LocalAddr().(*net.UDPAddr).Port
	_ = c.Close()
	return port
}

// genTestKeypair returns (privB64, pubB64) for a fresh clamped Curve25519 key.
func genTestKeypair(t *testing.T) (string, string) {
	t.Helper()
	var priv [32]byte
	if _, err := rand.Read(priv[:]); err != nil {
		t.Fatalf("rand: %v", err)
	}
	priv[0] &= 248
	priv[31] &= 127
	priv[31] |= 64
	pub, err := curve25519.X25519(priv[:], curve25519.Basepoint)
	if err != nil {
		t.Fatalf("x25519: %v", err)
	}
	return base64.StdEncoding.EncodeToString(priv[:]), base64.StdEncoding.EncodeToString(pub)
}

// hexKey converts a base64 WG key to the hex form the UAPI expects.
func hexKey(t *testing.T, b64 string) string {
	t.Helper()
	raw, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		t.Fatalf("decode key: %v", err)
	}
	return hex.EncodeToString(raw)
}
