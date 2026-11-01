package limiter

import (
	"testing"
	"time"

	"golang.org/x/time/rate"
)

func TestTierRatesAndCounts(t *testing.T) {
	const freeKBps = 100   // 100 KB/s
	const premiumMbps = 50 // 50 Mbit/s
	m := New(freeKBps, premiumMbps, 200, 200)

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

	if got, want := p.peak.Limit(), rate.Limit(200*bytesPerMbit); got != want {
		t.Fatalf("premium peak = %v, want %v (200 Mbit/s)", got, want)
	}
	if got := p.lim.Burst(); got != 200<<20 {
		t.Fatalf("premium burst = %d, want 200 MB", got)
	}

	// Demote back to free: rate returns, free count restored.
	m.SetTier("peerA", false)
	if got := p.lim.Limit(); got != wantFree {
		t.Fatalf("demoted rate = %v, want free %v", got, wantFree)
	}
	if got := p.peak.Limit(); got != rate.Inf {
		t.Fatalf("demoted peak = %v, want none", got)
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

func TestTotalBytes(t *testing.T) {
	m := New(100, 50, 200, 200)
	if got := m.TotalBytes(); got != 0 {
		t.Fatalf("TotalBytes on empty manager = %d, want 0", got)
	}
	m.Get("peerA").Count(1000)
	m.Get("peerB").Count(2500)
	m.Get("peerA").Count(500) // same peer accumulates
	if got := m.TotalBytes(); got != 4000 {
		t.Fatalf("TotalBytes = %d, want 4000 (1000+2500+500)", got)
	}
	m.Remove("peerB")
	if got := m.TotalBytes(); got != 1500 {
		t.Fatalf("TotalBytes after removing peerB = %d, want 1500", got)
	}
}

// A rested premium peer runs at the peak rate until its burst allowance is
// spent, then settles at the sustained rate.
func TestPremiumBurstThenSustained(t *testing.T) {
	const mbit = bytesPerMbit
	const allowance = 150 << 20 // 150 MB: ~8 s at 200 Mbit/s
	m := New(100, 50, 200, allowance>>20)
	m.SetTier("peerA", true)
	p := m.Get("peerA")

	// Start rested: wait (in virtual time) for a full sustained bucket.
	now := time.Now()
	for p.lim.TokensAt(now) < allowance {
		now = now.Add(time.Second)
	}

	// Send 32 KiB chunks as fast as both buckets allow; return the rate.
	const chunk = 32 << 10
	send := func(bytes int) float64 {
		start := now
		for sent := 0; sent < bytes; sent += chunk {
			at := now
			at = at.Add(p.peak.ReserveN(at, chunk).DelayFrom(at))
			at = at.Add(p.lim.ReserveN(at, chunk).DelayFrom(at))
			now = at
		}
		return float64(bytes) / now.Sub(start).Seconds()
	}

	send(peakBurst) // spend the peak bucket's own initial burst first
	if got := send(64 << 20); got < 190*mbit || got > 210*mbit {
		t.Fatalf("burst rate = %.0f Mbit/s, want ~200", got/mbit)
	}
	send(allowance) // more than what's left of the allowance
	if got := send(64 << 20); got < 48*mbit || got > 52*mbit {
		t.Fatalf("sustained rate = %.0f Mbit/s, want ~50", got/mbit)
	}
}

// Peak at or below the sustained rate turns bursting off: a flat ceiling.
func TestPremiumBurstOff(t *testing.T) {
	m := New(100, 50, 50, 200)
	m.SetTier("peerA", true)
	p := m.Get("peerA")
	if got := p.peak.Limit(); got != rate.Inf {
		t.Fatalf("peak = %v, want none when peak <= sustained", got)
	}
	if got := p.lim.Burst(); got != peakBurst {
		t.Fatalf("burst = %d, want the flat %d", got, peakBurst)
	}
}
