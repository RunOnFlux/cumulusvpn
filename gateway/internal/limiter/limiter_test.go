package limiter

import (
	"testing"

	"golang.org/x/time/rate"
)

func TestTierRatesAndCounts(t *testing.T) {
	const freeKBps = 100   // 100 KB/s
	const premiumMbps = 50 // 50 Mbit/s
	m := New(freeKBps, premiumMbps)

	wantFree := rate.Limit(freeKBps * 1024)
	wantPremium := rate.Limit(premiumMbps * bytesPerMbit) // 50 * 125_000 = 6_250_000 B/s

	// A fresh peer starts on the free tier.
	p := m.Get("peerA")
	if got := p.lim.Limit(); got != wantFree {
		t.Fatalf("new peer rate = %v, want free %v", got, wantFree)
	}
	if free, total := m.Counts(); free != 1 || total != 1 {
		t.Fatalf("counts after 1 free enroll = (%d,%d), want (1,1)", free, total)
	}

	// Promote to premium: rate rises to the 50 Mbit/s ceiling, free count drops.
	m.SetTier("peerA", true)
	if got := p.lim.Limit(); got != wantPremium {
		t.Fatalf("premium rate = %v, want %v (50 Mbit/s)", got, wantPremium)
	}
	if !p.Premium() {
		t.Fatal("peer should report premium")
	}
	if free, total := m.Counts(); free != 0 || total != 1 {
		t.Fatalf("counts after promote = (%d,%d), want (0,1)", free, total)
	}

	// Premium cap must sit below a single node's ~100 Mbit/s uplink so one peer
	// can't monopolize it (>=2 premium peers can run flat-out).
	nodeUplinkBytesPerSec := rate.Limit(100 * bytesPerMbit)
	if wantPremium*2 > nodeUplinkBytesPerSec {
		t.Fatalf("premium cap %v too high: two peers exceed the ~100 Mbit/s node uplink", wantPremium)
	}

	// Demote back to free: rate returns, free count restored.
	m.SetTier("peerA", false)
	if got := p.lim.Limit(); got != wantFree {
		t.Fatalf("demoted rate = %v, want free %v", got, wantFree)
	}
	if free, _ := m.Counts(); free != 1 {
		t.Fatalf("free count after demote = %d, want 1", free)
	}

	// Eviction clears state.
	m.Remove("peerA")
	if _, total := m.Counts(); total != 0 {
		t.Fatalf("total after remove = %d, want 0", total)
	}
}
