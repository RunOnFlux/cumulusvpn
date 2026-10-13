package api

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/runonflux/cumulusvpn-gateway/internal/config"
	"github.com/runonflux/cumulusvpn-gateway/internal/dnsproxy"
	"github.com/runonflux/cumulusvpn-gateway/internal/limiter"
	"github.com/runonflux/cumulusvpn-gateway/internal/wg"
)

// TestInfoAdvertisesSignedTransports guards the M0 transport-negotiation
// contract: /v1/info must carry a `transports` array (vanilla `wg` on the WG
// listen port), and adding it must NOT break the Ed25519 body signature that
// clients verify over the exact response bytes.
func TestInfoAdvertisesSignedTransports(t *testing.T) {
	// listen_port=0 lets wireguard-go pick a free UDP port — this test never
	// runs the data plane, only the control-API /v1/info handler.
	dev, err := wg.New(0, t.TempDir()+"/srv.key")
	if err != nil {
		t.Fatalf("wg.New: %v", err)
	}
	defer dev.Close()

	cfg := &config.Config{MaxPeersTotal: 2000, CapacityMbps: 1000}
	lim := limiter.New(100, 50)
	srv := New(cfg, dev, nil, lim, Info{Country: "DE"}, "203.0.113.1")

	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/v1/info")
	if err != nil {
		t.Fatalf("GET /v1/info: %v", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}

	// The signature must verify over the exact bytes, with the transports array
	// present — i.e. adding the field didn't desync the signed body.
	sig, err := base64.StdEncoding.DecodeString(resp.Header.Get("X-CVPN-Signature"))
	if err != nil {
		t.Fatalf("decode signature: %v", err)
	}
	pub, err := base64.StdEncoding.DecodeString(resp.Header.Get("X-CVPN-Sign-PubKey"))
	if err != nil {
		t.Fatalf("decode sign pubkey: %v", err)
	}
	if !ed25519.Verify(ed25519.PublicKey(pub), body, sig) {
		t.Fatal("signature does not verify over the /v1/info body (transports desynced the signed bytes)")
	}

	var env struct {
		Status string `json:"status"`
		Data   Info   `json:"data"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(env.Data.Transports) != 1 {
		t.Fatalf("want exactly one advertised transport, got %d", len(env.Data.Transports))
	}
	got := env.Data.Transports[0]
	if got.Type != "wg" || got.Port != config.WGListenPort {
		t.Fatalf("want vanilla transport {wg, %d}, got {%s, %d}", config.WGListenPort, got.Type, got.Port)
	}
}

// TestInfoAdvertisesObfsTransport verifies that when an obfuscated listener is
// wired via ExtraTransport, /v1/info advertises BOTH the vanilla and the awg
// transport (with obfuscation params), still under a valid body signature.
func TestInfoAdvertisesObfsTransport(t *testing.T) {
	dev, err := wg.New(0, t.TempDir()+"/srv.key")
	if err != nil {
		t.Fatalf("wg.New: %v", err)
	}
	defer dev.Close()
	obfsDev, err := wg.NewObfuscated(0, t.TempDir()+"/srv.key", wg.DefaultObfsParams)
	if err != nil {
		t.Fatalf("wg.NewObfuscated: %v", err)
	}
	defer obfsDev.Close()

	cfg := &config.Config{MaxPeersTotal: 2000, CapacityMbps: 1000}
	extra := ExtraTransport{
		Device:    obfsDev,
		Advertise: Transport{Type: "awg", Port: config.WGObfsPort, Params: wg.DefaultObfsParams.Map()},
	}
	srv := New(cfg, dev, nil, limiter.New(100, 50), Info{Country: "DE"}, "203.0.113.1", extra)

	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()
	resp, err := http.Get(ts.URL + "/v1/info")
	if err != nil {
		t.Fatalf("GET /v1/info: %v", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	sig, _ := base64.StdEncoding.DecodeString(resp.Header.Get("X-CVPN-Signature"))
	pub, _ := base64.StdEncoding.DecodeString(resp.Header.Get("X-CVPN-Sign-PubKey"))
	if !ed25519.Verify(ed25519.PublicKey(pub), body, sig) {
		t.Fatal("signature does not verify with the awg transport present")
	}

	var env struct {
		Data Info `json:"data"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(env.Data.Transports) != 2 {
		t.Fatalf("want 2 transports (wg + awg), got %d", len(env.Data.Transports))
	}
	awg := env.Data.Transports[1]
	if awg.Type != "awg" || awg.Port != config.WGObfsPort {
		t.Fatalf("want {awg, %d}, got {%s, %d}", config.WGObfsPort, awg.Type, awg.Port)
	}
	if awg.Params["jc"] == "" || awg.Params["h1"] == "" {
		t.Fatalf("awg transport missing obfuscation params: %v", awg.Params)
	}
}

// TestInfoReportsDNSMode pins the /v1/info `dns` object: "doh" with the proxy's
// counters when gateway-side encrypted DNS is on, "plain" (no counters) when
// CVPN_DNS_DOH=false left it unset — so the fleet's DNS posture is auditable
// from outside.
func TestInfoReportsDNSMode(t *testing.T) {
	dev, err := wg.New(0, t.TempDir()+"/srv.key")
	if err != nil {
		t.Fatalf("wg.New: %v", err)
	}
	defer dev.Close()
	cfg := &config.Config{MaxPeersTotal: 2000, CapacityMbps: 1000}

	for _, tc := range []struct {
		name  string
		proxy *dnsproxy.Proxy
		want  string
	}{
		{"doh", dnsproxy.New(dnsproxy.Options{}), `"dns":{"mode":"doh","encrypted":0,"fallbacks":0,"failed":0}`},
		{"plain", nil, `"dns":{"mode":"plain"}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv := New(cfg, dev, nil, limiter.New(100, 50), Info{Country: "DE"}, "203.0.113.1")
			srv.SetDNS(tc.proxy)
			ts := httptest.NewServer(srv.Handler())
			defer ts.Close()
			resp, err := http.Get(ts.URL + "/v1/info")
			if err != nil {
				t.Fatalf("GET /v1/info: %v", err)
			}
			defer resp.Body.Close()
			body, _ := io.ReadAll(resp.Body)
			if !strings.Contains(string(body), tc.want) {
				t.Fatalf("/v1/info = %s\nwant it to contain %s", body, tc.want)
			}
		})
	}
}
