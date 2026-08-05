package api

import (
	"testing"

	"github.com/runonflux/cumulusvpn-gateway/internal/config"
	"github.com/runonflux/cumulusvpn-gateway/internal/limiter"
	"github.com/runonflux/cumulusvpn-gateway/internal/wg"
)

// premiumFixture builds a vanilla device (the allocation authority) plus a
// premium-gated extra device, wired into a Server exactly as main.go does.
// listen_port=0 lets the kernel pick free ports; no data plane is exercised.
func premiumFixture(t *testing.T) (*Server, *wg.Device, *wg.Device) {
	t.Helper()
	dir := t.TempDir()
	dev, err := wg.New(0, dir+"/srv.key")
	if err != nil {
		t.Fatalf("wg.New: %v", err)
	}
	t.Cleanup(dev.Close)
	gated, err := wg.New(0, dir+"/srv.key") // same key file → same identity
	if err != nil {
		t.Fatalf("wg.New (gated): %v", err)
	}
	t.Cleanup(gated.Close)

	srv := New(
		&config.Config{MaxPeersTotal: 2000, CapacityMbps: 1000},
		dev, nil, limiter.New(100, 50), Info{Country: "DE"}, "203.0.113.1",
		ExtraTransport{
			Device:      gated,
			PremiumOnly: true,
			Advertise:   Transport{Type: "wg-tls", Port: 443, Params: map[string]string{"tier": "premium"}},
		},
	)
	return srv, dev, gated
}

// 32 zero bytes, standard base64 — a structurally valid WG public key.
const testPubKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="

// The gate's core promise: a free peer is never mirrored onto the premium-only
// device, so it can reach the TLS relay but can never complete the inner
// WireGuard handshake. (The relay bridges opaque frames and cannot itself check
// entitlement, which is exactly why enforcement lives in the peer set.)
func TestSyncPremiumPeersAddsAndRemovesWithEntitlement(t *testing.T) {
	srv, dev, gated := premiumFixture(t)

	// Enrolled on the authority device, but free → absent from the gated one.
	addr, err := srv.assign(testPubKey)
	if err != nil {
		t.Fatalf("assign: %v", err)
	}
	if err := dev.AddPeer(testPubKey, addr); err != nil {
		t.Fatalf("AddPeer: %v", err)
	}
	srv.SyncPremiumPeers(testPubKey, false)
	if _, on := gated.PeerAddr(testPubKey); on {
		t.Fatal("a free peer must not be on the premium-gated device")
	}

	// They pay: the next reconcile grants access WITHOUT a re-enroll, using the
	// address the authority device already assigned.
	srv.SyncPremiumPeers(testPubKey, true)
	got, on := gated.PeerAddr(testPubKey)
	if !on {
		t.Fatal("a premium peer must be added to the gated device by the reconcile")
	}
	if got != addr {
		t.Errorf("gated device must reuse the assigned address: got %v want %v", got, addr)
	}

	// Idempotent: a steady-state tick every 15s must not churn membership.
	srv.SyncPremiumPeers(testPubKey, true)
	if again, on := gated.PeerAddr(testPubKey); !on || again != addr {
		t.Error("repeat reconcile must be a no-op for an unchanged peer")
	}

	// Subscription lapses — expiry is eventless, so polling is the only way this
	// is ever revoked.
	srv.SyncPremiumPeers(testPubKey, false)
	if _, on := gated.PeerAddr(testPubKey); on {
		t.Error("an expired peer must lose access to the premium-gated device")
	}
}

// A peer that was never enrolled on the authority device must not be conjured
// onto the gated device (it has no assigned address).
func TestSyncPremiumPeersIgnoresUnenrolledKey(t *testing.T) {
	srv, _, gated := premiumFixture(t)
	srv.SyncPremiumPeers(testPubKey, true)
	if _, on := gated.PeerAddr(testPubKey); on {
		t.Error("an unenrolled key must not be added to the premium-gated device")
	}
}

// An UNgated extra transport must keep taking every peer — the gate is opt-in
// and must not change the default (free wg-tls / awg) behaviour.
func TestUngatedExtraTransportStillTakesFreePeers(t *testing.T) {
	dir := t.TempDir()
	dev, err := wg.New(0, dir+"/srv.key")
	if err != nil {
		t.Fatalf("wg.New: %v", err)
	}
	t.Cleanup(dev.Close)
	open, err := wg.New(0, dir+"/srv.key")
	if err != nil {
		t.Fatalf("wg.New (open): %v", err)
	}
	t.Cleanup(open.Close)

	srv := New(
		&config.Config{MaxPeersTotal: 2000, CapacityMbps: 1000},
		dev, nil, limiter.New(100, 50), Info{Country: "DE"}, "203.0.113.1",
		ExtraTransport{Device: open, Advertise: Transport{Type: "awg", Port: config.WGObfsPort}},
	)

	// SyncPremiumPeers must leave an ungated device completely alone.
	addr, err := srv.assign(testPubKey)
	if err != nil {
		t.Fatalf("assign: %v", err)
	}
	if err := dev.AddPeer(testPubKey, addr); err != nil {
		t.Fatalf("AddPeer: %v", err)
	}
	if err := open.AddPeer(testPubKey, addr); err != nil {
		t.Fatalf("AddPeer (open): %v", err)
	}
	srv.SyncPremiumPeers(testPubKey, false)
	if _, on := open.PeerAddr(testPubKey); !on {
		t.Error("an ungated transport must keep a free peer — the gate is opt-in")
	}
}
