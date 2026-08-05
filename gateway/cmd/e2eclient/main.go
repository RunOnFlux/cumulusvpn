// Command e2eclient is a self-contained data-plane test for the gateway.
//
// It performs the REAL client flow end to end so the WireGuard peer is actually
// registered before any traffic is sent:
//
//	generate a Curve25519 keypair  ->  solve the enroll PoW  ->  POST /v1/enroll
//	(which makes the gateway AddPeer our pubkey)  ->  bring up a userspace WG
//	tunnel with the returned server pubkey + assigned IP  ->  fetch a URL through
//	the tunnel and print what the internet sees.
//
// It exercises whichever transport is selected, so it is the tool that proves a
// LIVE gateway (local or deployed) actually serves that transport — see
// docs/16-validation.md.
//
// Env:
//
//	CONTROL       control API base URL         (default http://127.0.0.1:51821)
//	ENDPOINT      gateway endpoint host:port for the chosen transport. Defaults to
//	              127.0.0.1 on that transport's port. ALWAYS set this when testing
//	              a remote node — the enroll response's Endpoint is ignored, so
//	              leaving it unset silently dials localhost and the tunnel step
//	              fails even though enroll succeeded.
//	TEST_URL      URL to fetch through the tunnel (default http://checkip.amazonaws.com/)
//	CVPN_OBFS     non-empty → the obfuscated AmneziaWG transport (`awg`), default
//	              endpoint port 51821. Gateway needs CVPN_OBFS_ENABLE=1.
//	CVPN_TLS      non-empty → WireGuard-over-TLS (`wg-tls`): tunnel the WG socket
//	              through the gateway's TLS relay at ENDPOINT (default port 51820;
//	              use :443 for a stealth-group node). Gateway needs CVPN_TLS_ENABLE=1.
//	CVPN_TLS_SNI  SNI to present for CVPN_TLS   (default www.bing.com, the fleet default)
//
// Note CVPN_OBFS/CVPN_TLS are non-empty checks, so `CVPN_OBFS=0` still enables
// obfuscation — unset the variable to disable it.
package main

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/netip"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/amnezia-vpn/amneziawg-go/conn"
	"github.com/amnezia-vpn/amneziawg-go/device"
	"github.com/runonflux/cumulusvpn-gateway/internal/netstack"
	"github.com/runonflux/cumulusvpn-gateway/internal/tlsrelay"
	"github.com/runonflux/cumulusvpn-gateway/internal/wg"
	"golang.org/x/crypto/curve25519"
)

func b2h(s string) string { b, _ := base64.StdEncoding.DecodeString(s); return hex.EncodeToString(b) }

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

// genKeypair returns (privB64, pubB64) for a fresh clamped Curve25519 key —
// identical clamping to WireGuard's own key generation.
//
// Set CVPN_PRIV to a base64 private key to reuse a FIXED identity instead. That
// is what makes the premium half of the Stage E gate testable (docs/16): an
// entitlement is bought against one key's payment code, so a run that mints a
// throwaway key can only ever be a free peer. It also stops repeated runs from
// leaking a peer slot each time (docs/16 "Known gaps").
func genKeypair() (string, string) {
	if fixed := os.Getenv("CVPN_PRIV"); fixed != "" {
		raw, err := base64.StdEncoding.DecodeString(fixed)
		if err != nil || len(raw) != 32 {
			fmt.Println("CVPN_PRIV must be a base64 32-byte key")
			os.Exit(1)
		}
		var priv [32]byte
		copy(priv[:], raw)
		// Clamp defensively: a key generated elsewhere may not be clamped, and
		// an unclamped scalar yields a different public key than the wallet /
		// app derived — i.e. a payment code that never matches.
		priv[0] &= 248
		priv[31] &= 127
		priv[31] |= 64
		pub, err := curve25519.X25519(priv[:], curve25519.Basepoint)
		if err != nil {
			panic(err)
		}
		return base64.StdEncoding.EncodeToString(priv[:]), base64.StdEncoding.EncodeToString(pub)
	}
	var priv [32]byte
	if _, err := rand.Read(priv[:]); err != nil {
		panic(err)
	}
	priv[0] &= 248
	priv[31] &= 127
	priv[31] |= 64
	pub, err := curve25519.X25519(priv[:], curve25519.Basepoint)
	if err != nil {
		panic(err)
	}
	return base64.StdEncoding.EncodeToString(priv[:]), base64.StdEncoding.EncodeToString(pub)
}

// solvePoW mirrors the gateway's reference solver: find nonce (decimal string)
// s.t. sha256(pubkeyB64 || nonceDecimal) has `bits` leading zero bits.
func solvePoW(pubkey string, bits int) string {
	full, rem := bits/8, bits%8
	mask := byte(0xff << (8 - rem))
	for i := uint64(0); ; i++ {
		nonce := strconv.FormatUint(i, 10)
		h := sha256.Sum256(append([]byte(pubkey), nonce...))
		ok := true
		for j := 0; j < full; j++ {
			if h[j] != 0 {
				ok = false
				break
			}
		}
		if ok && rem != 0 && h[full]&mask != 0 {
			ok = false
		}
		if ok {
			return nonce
		}
	}
}

type enrollResp struct {
	Data struct {
		ServerPubKey string `json:"server_pubkey"`
		Endpoint     string `json:"endpoint"`
		AssignedIP   string `json:"assigned_ip"`
		DNS          string `json:"dns"`
		PaymentMemo  string `json:"payment_memo"`
	} `json:"data"`
}

func main() {
	control := env("CONTROL", "http://127.0.0.1:51821")
	// CVPN_OBFS=1 exercises the DPI-resistant (AmneziaWG) transport: dial the
	// obfs UDP port by default and apply the fleet obfuscation profile. Requires
	// the gateway to run with CVPN_OBFS_ENABLE=1.
	obfs := env("CVPN_OBFS", "") != ""
	// CVPN_TLS=1 exercises the wg-tls transport: the WG device dials a LOCAL udp
	// socket owned by a client bridge that tunnels the datagrams over one TLS
	// connection to the gateway's relay (the same ClientBridge the Go reference
	// client uses). Requires CVPN_TLS_ENABLE=1 on the gateway.
	useTLS := env("CVPN_TLS", "") != ""
	if obfs && useTLS {
		fmt.Println("CVPN_OBFS and CVPN_TLS are mutually exclusive — pick one transport")
		os.Exit(2)
	}
	defEndpoint := "127.0.0.1:51820" // vanilla, and the default TLS relay port
	if obfs {
		defEndpoint = "127.0.0.1:51821"
	}
	wgEndpoint := env("ENDPOINT", defEndpoint)
	tlsSNI := env("CVPN_TLS_SNI", "www.bing.com")
	testURL := env("TEST_URL", "http://checkip.amazonaws.com/")
	transportName := "wg (vanilla)"
	switch {
	case obfs:
		transportName = "awg (AmneziaWG)"
	case useTLS:
		transportName = "wg-tls (WireGuard-over-TLS)"
	}
	fmt.Printf("transport=%s  control=%s  endpoint=%s\n", transportName, control, wgEndpoint)

	priv, pub := genKeypair()
	nonce := solvePoW(pub, 20)
	fmt.Printf("client pubkey=%s  pow_nonce=%s\n", pub, nonce)

	reqBody, _ := json.Marshal(map[string]string{"pubkey": pub, "pow_nonce": nonce})
	// Bounded: a node that blackholes packets must fail the run, not hang it.
	enrollClient := &http.Client{Timeout: 20 * time.Second}
	r, err := enrollClient.Post(control+"/v1/enroll", "application/json", bytes.NewReader(reqBody))
	if err != nil {
		fmt.Println("ENROLL FAILED:", err)
		os.Exit(1)
	}
	raw, _ := io.ReadAll(r.Body)
	r.Body.Close()
	if r.StatusCode != 200 {
		fmt.Printf("ENROLL HTTP %d: %s\n", r.StatusCode, raw)
		os.Exit(1)
	}
	var er enrollResp
	if err := json.Unmarshal(raw, &er); err != nil {
		fmt.Println("bad enroll json:", err)
		os.Exit(1)
	}
	fmt.Printf("enrolled: assigned_ip=%s server_pub=%s dns=%s memo=%s\n",
		er.Data.AssignedIP, er.Data.ServerPubKey, er.Data.DNS, er.Data.PaymentMemo)

	// wg-tls: stand up the UDP<->TLS bridge to the gateway's relay and point the
	// WG device at the bridge's LOCAL udp endpoint instead of the gateway.
	if useTLS {
		bridge, err := tlsrelay.DialClientBridge(wgEndpoint, tlsSNI)
		if err != nil {
			fmt.Printf("TLS BRIDGE FAILED (relay %s, sni %q): %v\n", wgEndpoint, tlsSNI, err)
			os.Exit(1)
		}
		defer bridge.Close()
		fmt.Printf("tls bridge up: relay=%s sni=%s local=%s\n", wgEndpoint, tlsSNI, bridge.LocalEndpoint())
		wgEndpoint = bridge.LocalEndpoint()
	}

	tun, tnet, err := netstack.CreateNetTUN(
		[]netip.Addr{netip.MustParseAddr(er.Data.AssignedIP)},
		[]netip.Addr{netip.MustParseAddr(er.Data.DNS)}, 1420)
	if err != nil {
		panic(err)
	}
	dev := device.NewDevice(tun, conn.NewDefaultBind(), device.NewLogger(device.LogLevelError, "c "))
	// Interface section first (private key + obfuscation profile, device-level),
	// THEN the peer — obfs UAPI keys must precede the public_key= peer line.
	cfg := fmt.Sprintf("private_key=%s\n", b2h(priv))
	if obfs {
		cfg += wg.DefaultObfsParams.UAPI()
	}
	cfg += fmt.Sprintf("public_key=%s\nendpoint=%s\nallowed_ip=0.0.0.0/0\npersistent_keepalive_interval=5\n",
		b2h(er.Data.ServerPubKey), wgEndpoint)
	if err := dev.IpcSet(cfg); err != nil {
		panic(err)
	}
	if err := dev.Up(); err != nil {
		panic(err)
	}

	hc := &http.Client{Timeout: 25 * time.Second, Transport: &http.Transport{DialContext: tnet.DialContext}}
	resp, err := hc.Get(testURL)
	if err != nil {
		fmt.Println("TUNNEL FAILED:", err)
		os.Exit(1)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	seen := strings.TrimSpace(string(body))
	// A non-200 means something answered but the tunnel isn't carrying a healthy
	// flow (captive portal, upstream error) — that must not read as a pass.
	if resp.StatusCode != http.StatusOK {
		fmt.Printf("TUNNEL FAILED — HTTP %d via %s — body: %s\n", resp.StatusCode, transportName, seen)
		os.Exit(1)
	}
	fmt.Printf("TUNNEL OK — HTTP 200 via %s — internet sees: %s\n", transportName, seen)
	// The exit IP is the actual proof the gateway egressed the traffic: it must be
	// the NODE's address, not the tester's.
	fmt.Println("PASS if the address above is the gateway node's public IP (not yours).")
}
