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
// Env:
//
//	CONTROL   control API base URL            (default http://127.0.0.1:51821)
//	ENDPOINT  WG udp endpoint host:port        (default 127.0.0.1:51820; overrides
//	          the enroll response, whose Endpoint is the node's public IP)
//	TEST_URL  URL to fetch through the tunnel   (default http://checkip.amazonaws.com/)
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
	"time"

	"github.com/runonflux/cumulusvpn-gateway/internal/netstack"
	"golang.org/x/crypto/curve25519"
	"golang.zx2c4.com/wireguard/conn"
	"golang.zx2c4.com/wireguard/device"
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
func genKeypair() (string, string) {
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
	wgEndpoint := env("ENDPOINT", "127.0.0.1:51820")
	testURL := env("TEST_URL", "http://checkip.amazonaws.com/")

	priv, pub := genKeypair()
	nonce := solvePoW(pub, 20)
	fmt.Printf("client pubkey=%s  pow_nonce=%s\n", pub, nonce)

	reqBody, _ := json.Marshal(map[string]string{"pubkey": pub, "pow_nonce": nonce})
	r, err := http.Post(control+"/v1/enroll", "application/json", bytes.NewReader(reqBody))
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

	tun, tnet, err := netstack.CreateNetTUN(
		[]netip.Addr{netip.MustParseAddr(er.Data.AssignedIP)},
		[]netip.Addr{netip.MustParseAddr(er.Data.DNS)}, 1420)
	if err != nil {
		panic(err)
	}
	dev := device.NewDevice(tun, conn.NewDefaultBind(), device.NewLogger(device.LogLevelError, "c "))
	cfg := fmt.Sprintf("private_key=%s\npublic_key=%s\nendpoint=%s\nallowed_ip=0.0.0.0/0\npersistent_keepalive_interval=5\n",
		b2h(priv), b2h(er.Data.ServerPubKey), wgEndpoint)
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
	fmt.Printf("TUNNEL OK — HTTP %d — internet sees: %s\n", resp.StatusCode, string(body))
}
