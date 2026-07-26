package wg

import (
	"net/netip"
	"path/filepath"
	"testing"
)

// TestPeerSurvivesRestart is the regression test for the bug the peer cache
// exists to fix: a gateway restart used to silently de-register every client.
//
// The full apps hide that by re-enrolling on connect, so it looked harmless.
// It is not: the web client hands the user a static WireGuard .conf that the
// stock app consumes, and nothing in that file can re-enroll. After a restart
// their tunnel reports connected and never completes a handshake — with
// AllowedIPs 0.0.0.0/0, that means no internet until they notice and turn it
// off. Restarts are routine here (any Flux app update redeploys the container),
// so this is the difference between a config that lasts and one that is quietly
// disposable.
//
// The assertion is deliberately strict about the ADDRESS, not just membership:
// re-registering a peer under a different tunnel IP would break an issued .conf
// exactly as thoroughly as dropping it, since Address is baked into the file.
func TestPeerSurvivesRestart(t *testing.T) {
	dir := t.TempDir()
	keyFile := filepath.Join(dir, "server.key")
	cacheFile := filepath.Join(dir, "peers.cache")

	peer := testKey(7)
	assigned := netip.MustParseAddr("10.8.3.42")

	// --- first boot: a client enrolls ---
	first, err := New(freeUDPPort(t), keyFile)
	if err != nil {
		t.Fatalf("first boot: %v", err)
	}
	first.SetPeerCache(cacheFile)
	if err := first.AddPeer(peer, assigned); err != nil {
		t.Fatalf("enroll: %v", err)
	}
	firstPub := first.PublicKey()
	first.Close()

	// --- restart: same key file, same cache, fresh device ---
	second, err := New(freeUDPPort(t), keyFile)
	if err != nil {
		t.Fatalf("restart: %v", err)
	}
	t.Cleanup(second.Close)

	// The server identity must be stable too — a new server key would change the
	// [Peer] PublicKey in every issued .conf and break them just as hard.
	if second.PublicKey() != firstPub {
		t.Errorf("server pubkey changed across restart: %s -> %s", firstPub, second.PublicKey())
	}

	// Before restoring, the peer is gone — this is the bug, asserted so the test
	// fails loudly if persistence silently starts happening somewhere else.
	if _, ok := second.PeerAddr(peer); ok {
		t.Fatal("peer present before RestorePeers — the test is not exercising the restore path")
	}

	restored, clean := LoadPeerCache(cacheFile, 0)
	if !clean {
		t.Error("the cache we just wrote must read back cleanly")
	}
	if n := second.RestorePeers(restored); n != 1 {
		t.Fatalf("restored %d peers, want 1", n)
	}

	got, ok := second.PeerAddr(peer)
	if !ok {
		t.Fatal("peer did not survive the restart")
	}
	if got != assigned {
		t.Errorf("peer came back with address %v, want %v — an issued .conf pins the old one", got, assigned)
	}
	if second.PeerCount() != 1 {
		t.Errorf("peer count %d after restore, want 1", second.PeerCount())
	}
}

// A removal must also survive: a peer deregistered before the restart must not
// come back afterwards, or a revoked config would resurrect itself.
func TestRemovedPeerDoesNotComeBack(t *testing.T) {
	dir := t.TempDir()
	cacheFile := filepath.Join(dir, "peers.cache")

	dev, err := New(freeUDPPort(t), filepath.Join(dir, "server.key"))
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(dev.Close)
	dev.SetPeerCache(cacheFile)

	keep, drop := testKey(1), testKey(2)
	if err := dev.AddPeer(keep, netip.MustParseAddr("10.8.0.2")); err != nil {
		t.Fatal(err)
	}
	if err := dev.AddPeer(drop, netip.MustParseAddr("10.8.0.3")); err != nil {
		t.Fatal(err)
	}
	if err := dev.RemovePeer(drop); err != nil {
		t.Fatal(err)
	}

	got, _ := LoadPeerCache(cacheFile, 0)
	if len(got) != 1 || got[0].PubKey != keep {
		t.Fatalf("cache holds %d record(s) after a removal, want only the kept peer", len(got))
	}
}
