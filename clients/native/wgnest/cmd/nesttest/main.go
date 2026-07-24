// Command nesttest drives the wgnest nested tunnel end-to-end against two live
// gateways: it enrolls one client key K at an ENTRY and an EXIT gateway, brings
// up the nested tunnel, and fetches an "what's my IP" URL through it. Success is
// the internet seeing the EXIT gateway's IP (not the entry's, not the host's).
//
//	ENTRY=176.9.64.29 EXIT=142.132.249.46 go run ./cmd/nesttest
package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/netip"
	"os"
	"strconv"
	"time"

	"github.com/amnezia-vpn/amneziawg-go/device"
	"github.com/amnezia-vpn/amneziawg-go/tun/netstack"
	"golang.org/x/crypto/curve25519"

	"github.com/runonflux/cumulusvpn-wgnest"
)

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func genKeypair() (privB64, pubB64 string) {
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

// solvePoW: random start so each enroll uses a fresh nonce (gateway single-uses).
func solvePoW(pub string, bits int) string {
	full, rem := bits/8, bits%8
	mask := byte(0xff << (8 - rem))
	var start [8]byte
	_, _ = rand.Read(start[:])
	i := uint64(start[0]) | uint64(start[1])<<8 | uint64(start[2])<<16
	for ; ; i++ {
		nonce := strconv.FormatUint(i, 10)
		h := sha256.Sum256(append([]byte(pub), nonce...))
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
	} `json:"data"`
}

func enroll(gatewayIP, pub string) (enrollResp, error) {
	body, _ := json.Marshal(map[string]string{"pubkey": pub, "pow_nonce": solvePoW(pub, 20)})
	r, err := http.Post("http://"+gatewayIP+":51821/v1/enroll", "application/json", bytes.NewReader(body))
	if err != nil {
		return enrollResp{}, err
	}
	defer r.Body.Close()
	raw, _ := io.ReadAll(r.Body)
	if r.StatusCode != 200 {
		return enrollResp{}, fmt.Errorf("enroll %s HTTP %d: %s", gatewayIP, r.StatusCode, raw)
	}
	var er enrollResp
	return er, json.Unmarshal(raw, &er)
}

func main() {
	entryIP := env("ENTRY", "176.9.64.29")
	exitIP := env("EXIT", "142.132.249.46")
	testURL := env("TEST_URL", "http://checkip.amazonaws.com/")

	priv, pub := genKeypair()
	fmt.Printf("client pubkey=%s\nentry=%s exit=%s\n", pub, entryIP, exitIP)

	en, err := enroll(entryIP, pub)
	if err != nil {
		fmt.Println("ENTRY enroll failed:", err)
		os.Exit(1)
	}
	ex, err := enroll(exitIP, pub)
	if err != nil {
		fmt.Println("EXIT enroll failed:", err)
		os.Exit(1)
	}
	fmt.Printf("entry: assigned=%s serverpub=%s\n", en.Data.AssignedIP, en.Data.ServerPubKey)
	fmt.Printf("exit : assigned=%s serverpub=%s dns=%s\n", ex.Data.AssignedIP, ex.Data.ServerPubKey, ex.Data.DNS)

	// INNER tun: a netstack with the EXIT-assigned address; real traffic flows here.
	innerTun, innerNet, err := netstack.CreateNetTUN(
		[]netip.Addr{netip.MustParseAddr(ex.Data.AssignedIP)},
		[]netip.Addr{netip.MustParseAddr(ex.Data.DNS)},
		1340, // room for two stacked WireGuard headers
	)
	if err != nil {
		panic(err)
	}

	tunnel, err := wgnest.Start(
		priv,
		wgnest.Gateway{PubKeyB64: en.Data.ServerPubKey, IP: netip.MustParseAddr(entryIP), AssignedIP: netip.MustParseAddr(en.Data.AssignedIP)},
		wgnest.Gateway{PubKeyB64: ex.Data.ServerPubKey, IP: netip.MustParseAddr(exitIP), AssignedIP: netip.MustParseAddr(ex.Data.AssignedIP)},
		innerTun,
		device.LogLevelError,
	)
	if err != nil {
		fmt.Println("NEST START FAILED:", err)
		os.Exit(1)
	}
	defer tunnel.Close()

	hc := &http.Client{Timeout: 30 * time.Second, Transport: &http.Transport{DialContext: innerNet.DialContext}}
	// A short retry to absorb the two handshakes coming up.
	deadline := time.Now().Add(30 * time.Second)
	for {
		resp, err := hc.Get(testURL)
		if err == nil {
			b, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			fmt.Printf("NESTED TUNNEL OK — internet sees: %s (exit=%s)\n", trim(string(b)), exitIP)
			return
		}
		if time.Now().After(deadline) {
			fmt.Println("NESTED TUNNEL FAILED:", err)
			os.Exit(1)
		}
		_ = context.Background()
		time.Sleep(1500 * time.Millisecond)
	}
}

func trim(s string) string {
	for len(s) > 0 && (s[len(s)-1] == '\n' || s[len(s)-1] == '\r' || s[len(s)-1] == ' ') {
		s = s[:len(s)-1]
	}
	return s
}
