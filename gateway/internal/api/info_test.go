package api

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/runonflux/cumulusvpn-gateway/internal/config"
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
