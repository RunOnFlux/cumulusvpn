package wg

import (
	"net/netip"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func recs(t *testing.T, pairs ...string) []PeerRecord {
	t.Helper()
	out := make([]PeerRecord, 0, len(pairs)/2)
	for i := 0; i < len(pairs); i += 2 {
		out = append(out, PeerRecord{PubKey: pairs[i], Addr: netip.MustParseAddr(pairs[i+1])})
	}
	return out
}

// testKey returns a syntactically valid WG pubkey (base64 of 32 bytes) that
// varies with n, so records are distinguishable.
func testKey(n byte) string {
	var raw [32]byte
	raw[0] = n
	raw[31] = n
	return b64Key(raw)
}

func b64Key(raw [32]byte) string {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
	// Encode manually to avoid importing encoding/base64 twice in the test file's
	// mental model; standard padding to 44 chars for 32 bytes.
	var sb strings.Builder
	for i := 0; i < 30; i += 3 {
		v := uint32(raw[i])<<16 | uint32(raw[i+1])<<8 | uint32(raw[i+2])
		sb.WriteByte(alphabet[(v>>18)&63])
		sb.WriteByte(alphabet[(v>>12)&63])
		sb.WriteByte(alphabet[(v>>6)&63])
		sb.WriteByte(alphabet[v&63])
	}
	v := uint32(raw[30])<<16 | uint32(raw[31])<<8
	sb.WriteByte(alphabet[(v>>18)&63])
	sb.WriteByte(alphabet[(v>>12)&63])
	sb.WriteByte(alphabet[(v>>6)&63])
	sb.WriteByte('=')
	return sb.String()
}

// The whole point of the cache: what was enrolled before the restart is still
// enrolled after it, with the SAME assigned address (a changed address would
// break an issued .conf just as thoroughly as losing the peer).
func TestPeerCacheRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "peers.cache")
	in := recs(t, testKey(1), "10.8.0.2", testKey(2), "10.8.1.77")

	if err := savePeerCache(path, in); err != nil {
		t.Fatalf("save: %v", err)
	}
	got, clean := LoadPeerCache(path, 0)
	if !clean {
		t.Error("a file we just wrote must read back cleanly")
	}
	if len(got) != 2 {
		t.Fatalf("loaded %d records, want 2", len(got))
	}
	byKey := map[string]netip.Addr{}
	for _, r := range got {
		byKey[r.PubKey] = r.Addr
	}
	for _, want := range in {
		if byKey[want.PubKey] != want.Addr {
			t.Errorf("peer %s: address %v, want %v", want.PubKey[:8], byKey[want.PubKey], want.Addr)
		}
	}
}

// A missing cache is the normal first-boot case and must be silent, not an error
// — the gateway has to come up on a fresh volume.
func TestPeerCacheMissingFileIsEmpty(t *testing.T) {
	got, clean := LoadPeerCache(filepath.Join(t.TempDir(), "nope.cache"), 0)
	if got != nil {
		t.Errorf("missing cache returned %d records, want none", len(got))
	}
	// First boot must be CLEAN, or the gateway would never start persisting.
	if !clean {
		t.Error("a missing cache is first boot, not corruption")
	}
}

// Corruption must degrade to the pre-persistence behaviour (everyone re-enrolls)
// rather than taking the gateway down or, worse, injecting a bad peer.
func TestPeerCacheRejectsGarbage(t *testing.T) {
	dir := t.TempDir()

	cases := map[string]string{
		"no version header": "notavalidheader\n" + testKey(1) + " 10.8.0.2\n",
		"empty file":        "",
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(dir, strings.ReplaceAll(name, " ", "-")+".cache")
			if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
				t.Fatal(err)
			}
			got, clean := LoadPeerCache(path, 0)
			if len(got) != 0 {
				t.Errorf("loaded %d records from %q, want 0", len(got), name)
			}
			if name == "no version header" && clean {
				t.Error("an unknown format must NOT be clean — persisting would erase it")
			}
		})
	}

	// A well-formed file with individually bad lines keeps the good ones and
	// drops the rest — one corrupt entry must not cost everyone else.
	path := filepath.Join(dir, "mixed.cache")
	body := peerCacheV2 + "\n" +
		testKey(1) + " 10.8.0.2\n" + // good
		"not-a-key 10.8.0.3\n" + // bad key
		testKey(2) + " not-an-ip\n" + // bad address
		testKey(3) + "\n" + // missing address
		testKey(4) + " 10.8.0.9\n" + // good
		testKey(1) + " 10.8.0.250\n" // duplicate key, must not override
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	got, clean := LoadPeerCache(path, 0)
	if !clean {
		t.Error("individually malformed rows are recoverable; the file is still ours to rewrite")
	}
	if len(got) != 2 {
		t.Fatalf("loaded %d records, want 2 good ones", len(got))
	}
	for _, r := range got {
		if r.PubKey == testKey(1) && r.Addr != netip.MustParseAddr("10.8.0.2") {
			t.Errorf("duplicate line overrode the first: got %v", r.Addr)
		}
	}
}

// The ceiling exists so a grown or tampered file can't push the peer table past
// the capacity the gateway's own guards enforce.
func TestPeerCacheHonoursCeiling(t *testing.T) {
	path := filepath.Join(t.TempDir(), "peers.cache")
	var in []PeerRecord
	for i := 1; i <= 10; i++ {
		in = append(in, PeerRecord{PubKey: testKey(byte(i)), Addr: netip.AddrFrom4([4]byte{10, 8, 0, byte(i + 1)})})
	}
	if err := savePeerCache(path, in); err != nil {
		t.Fatal(err)
	}
	got, clean := LoadPeerCache(path, 4)
	if len(got) != 4 {
		t.Errorf("ceiling 4 returned %d records", len(got))
	}
	// Hitting the ceiling must mark the load unclean: the 6 we did not register
	// are still on disk, and a write-back would delete them.
	if clean {
		t.Error("a truncated load must not be clean — persisting would drop the excess")
	}
	got, clean = LoadPeerCache(path, 0)
	if len(got) != 10 {
		t.Errorf("ceiling 0 (unbounded) returned %d records, want 10", len(got))
	}
	if !clean {
		t.Error("reading every record is a clean load")
	}
}

// Saving must be atomic: a reader concurrent with a write sees either the old
// file or the new one, never a truncated one. Verified indirectly by checking no
// temp file survives a successful save (a leaked .tmp would also fill /data).
func TestPeerCacheSaveLeavesNoTempFiles(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "peers.cache")
	for i := 0; i < 3; i++ {
		if err := savePeerCache(path, recs(t, testKey(byte(i+1)), "10.8.0.2")); err != nil {
			t.Fatal(err)
		}
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".tmp") {
			t.Errorf("leaked temp file %s", e.Name())
		}
	}
	if len(entries) != 1 {
		t.Errorf("expected only the cache file, got %d entries", len(entries))
	}
}

// An unwritable path must not be fatal — /data is not guaranteed writable, which
// is already true of the server key.
func TestPeerCacheSaveFailsSoftly(t *testing.T) {
	// A path whose parent does not exist stands in for an unwritable volume.
	err := savePeerCache(filepath.Join(t.TempDir(), "no-such-dir", "peers.cache"), nil)
	if err == nil {
		t.Fatal("expected an error for an unwritable path")
	}
	// Device.persist() logs and swallows this; the contract under test is that
	// savePeerCache REPORTS rather than panics or half-writes.
}

// The review found this the hard way: SetPeerCache used to write on the way in,
// so a load that FAILED — unreadable file, a format this build doesn't know,
// more peers than the ceiling — was immediately followed by a write derived from
// the little that was recovered. A transient permission error or a rollback
// became permanent, silent data loss. Enabling the cache must never touch disk.
func TestSetPeerCacheDoesNotWrite(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "peers.cache")

	// A file this build cannot parse stands in for a rollback / future format.
	original := "cvpn-peers-v99\n" + testKey(1) + " 10.8.0.2 1750000000\n"
	if err := os.WriteFile(path, []byte(original), 0o600); err != nil {
		t.Fatal(err)
	}

	recs, clean := LoadPeerCache(path, 0)
	if clean {
		t.Fatal("an unknown format must report an unclean load")
	}
	if len(recs) != 0 {
		t.Fatalf("recovered %d records from an unknown format, want 0", len(recs))
	}

	// Even if a caller ignores `clean` and enables the cache anyway, merely
	// enabling it must not destroy the file.
	dev := &Device{
		byKey:  make(map[string]netip.Addr),
		byAddr: make(map[netip.Addr]string),
		seen:   make(map[string]time.Time),
	}
	dev.SetPeerCache(path)

	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(after) != original {
		t.Errorf("SetPeerCache rewrote a file it could not read:\n got: %q\nwant: %q", after, original)
	}
}

// v1 files (no last-seen column) must still restore every peer — an upgrade must
// not cost anyone their enrollment — and must be stamped as fresh so the first
// eviction sweep after the upgrade reaps nobody.
func TestPeerCacheReadsV1AndStampsFresh(t *testing.T) {
	path := filepath.Join(t.TempDir(), "peers.cache")
	body := peerCacheV1 + "\n" + testKey(1) + " 10.8.0.2\n" + testKey(2) + " 10.8.0.3\n"
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	got, clean := LoadPeerCache(path, 0)
	if !clean {
		t.Error("v1 is a format we understand; the load is clean")
	}
	if len(got) != 2 {
		t.Fatalf("loaded %d records from a v1 file, want 2", len(got))
	}
	for _, r := range got {
		if time.Since(r.Seen) > time.Minute {
			t.Errorf("v1 record stamped %v — an upgrade must not make peers look idle", r.Seen)
		}
	}
}

// The last-seen stamp has to survive a save/load cycle, or eviction would reset
// every peer's clock on every restart and never reap anything.
func TestPeerCachePreservesLastSeen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "peers.cache")
	old := time.Now().Add(-40 * 24 * time.Hour).Truncate(time.Second)
	if err := savePeerCache(path, []PeerRecord{
		{PubKey: testKey(1), Addr: netip.MustParseAddr("10.8.0.2"), Seen: old},
	}); err != nil {
		t.Fatal(err)
	}
	got, _ := LoadPeerCache(path, 0)
	if len(got) != 1 {
		t.Fatalf("loaded %d records, want 1", len(got))
	}
	if !got[0].Seen.Equal(old) {
		t.Errorf("last-seen came back as %v, want %v", got[0].Seen, old)
	}
}

// Leftover temp files from a save that died mid-write must be swept, or they
// accumulate in /data forever — one per crash.
func TestPeerCacheSweepsOrphanTempFiles(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "peers.cache")
	orphan := filepath.Join(dir, ".peers-orphan.tmp")
	if err := os.WriteFile(orphan, []byte("junk"), 0o600); err != nil {
		t.Fatal(err)
	}
	LoadPeerCache(path, 0)
	if _, err := os.Stat(orphan); !os.IsNotExist(err) {
		t.Error("orphaned temp file was not swept")
	}
}

// PersistHealthy must be FALSE whenever enrollments would not actually survive a
// restart — including when persistence was never enabled, which is what main.go
// deliberately does after an unclean load. A node in that state keeps enrolling
// peers and advertising capacity while quietly losing everyone at the next
// restart, and nothing else distinguishes it from a healthy node from outside.
func TestPersistHealthyReportsTheDangerousState(t *testing.T) {
	dir := t.TempDir()
	dev := &Device{
		byKey:  make(map[string]netip.Addr),
		byAddr: make(map[netip.Addr]string),
		seen:   make(map[string]time.Time),
	}

	if dev.PersistHealthy() {
		t.Error("a device with no cache path is NOT persisting; it must not report healthy")
	}

	dev.SetPeerCache(filepath.Join(dir, "peers.cache"))
	dev.persist()
	if !dev.PersistHealthy() {
		t.Error("a writable cache path must report healthy")
	}

	// An unwritable location stands in for a read-only or full /data.
	dev.SetPeerCache(filepath.Join(dir, "no-such-dir", "peers.cache"))
	dev.persist()
	if dev.PersistHealthy() {
		t.Error("a failing write must report unhealthy")
	}
}
