package api

import (
	"context"
	"strconv"
	"testing"
	"time"
)

// newGCServer builds a bare Server with just the GC-relevant maps, mirroring how
// pow_test.go constructs one (no New, no ctx, no devices).
func newGCServer() *Server {
	return &Server{
		enrollIP:     make(map[string]time.Time),
		powSeen:      make(map[string]struct{}),
		powSeenPrev:  make(map[string]struct{}),
		powRotatedAt: time.Now(),
	}
}

// A stale enrollIP entry can no longer affect an allowEnroll decision, so
// sweeping it must be behaviour-neutral: the swept IP is allowed exactly as an
// unknown IP would be, while an in-window IP stays rate-limited.
func TestGCSweepsOnlyStaleEnrollIP(t *testing.T) {
	s := newGCServer()
	now := time.Now()
	s.enrollIP["1.1.1.1"] = now.Add(-time.Minute) // long stale
	s.enrollIP["2.2.2.2"] = now                   // fresh, inside the window

	s.gcOnce(now)

	if _, ok := s.enrollIP["1.1.1.1"]; ok {
		t.Error("stale enrollIP entry should have been swept")
	}
	if _, ok := s.enrollIP["2.2.2.2"]; !ok {
		t.Fatal("in-window enrollIP entry must survive — sweeping it would disable the rate limit")
	}
	// Behaviour equivalence: swept IP behaves like a never-seen IP (allowed),
	// the retained one is still limited.
	if !s.allowEnroll("1.1.1.1") {
		t.Error("swept IP should be allowed, exactly as an unknown IP is")
	}
	if s.allowEnroll("2.2.2.2") {
		t.Error("in-window IP must still be rate-limited after a sweep")
	}
}

// An entry younger than the window must never be swept — deleting one would let
// a currently rate-limited IP straight through.
func TestGCPreservesInWindowEnrollIP(t *testing.T) {
	s := newGCServer()
	now := time.Now()
	s.enrollIP["3.3.3.3"] = now.Add(-time.Second) // 1s old, window is 2s

	s.gcOnce(now)

	if _, ok := s.enrollIP["3.3.3.3"]; !ok {
		t.Fatal("entry inside the rate-limit window must not be swept")
	}
}

// The replay guard's contract: a spent nonce stays rejected for at least one
// rotation period (it lives on in the previous generation) and is only
// forgotten after a second rotation. Pins the documented R..2R lifetime so a
// refactor to a single generation can't silently halve it.
func TestPowSeenRotationKeepsPreviousGeneration(t *testing.T) {
	s := newGCServer()
	pk := "pubkey"
	nonce := "nonce"
	key := pk + "|" + nonce
	s.powSeen[key] = struct{}{}

	// One rotation: the nonce moves to the previous generation, still rejected.
	s.gcOnce(s.powRotatedAt.Add(powGeneration))
	if _, seen := s.powSeen[key]; seen {
		t.Error("rotation should have moved the nonce out of the current generation")
	}
	if _, seen := s.powSeenPrev[key]; !seen {
		t.Fatal("nonce must survive one rotation in the previous generation")
	}

	// A second rotation drops it entirely — the bound that keeps memory finite.
	s.gcOnce(s.powRotatedAt.Add(powGeneration))
	if _, seen := s.powSeenPrev[key]; seen {
		t.Error("nonce should be forgotten after two rotations")
	}
}

// Under an enroll flood the map must degrade into a SHORTER replay window
// rather than growing until the container is OOM-killed.
func TestPowSeenHardCapRotatesEarly(t *testing.T) {
	s := newGCServer()
	for i := 0; i <= maxPowSeen; i++ {
		s.powSeen[strconv.Itoa(i)] = struct{}{}
	}
	before := s.powRotatedAt

	// Well inside the time-based period — only the cap can trigger this.
	s.gcOnce(before.Add(time.Second))

	if len(s.powSeen) != 0 {
		t.Errorf("hard cap should have rotated the current generation, got %d entries", len(s.powSeen))
	}
	if !s.powRotatedAt.After(before) {
		t.Error("rotation timestamp should advance when the cap fires")
	}
}

// The GC goroutine must exit on shutdown like SampleLoad, or every gateway
// restart leaks one.
func TestGCStopsOnContextCancel(t *testing.T) {
	s := newGCServer()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		s.GC(ctx)
		close(done)
	}()
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("GC did not return after context cancellation")
	}
}

// allowEnroll had no coverage at all. Pins the window, per-IP independence, and
// the subtle bit: a REJECTED call must not extend the window.
func TestAllowEnrollWindow(t *testing.T) {
	s := newGCServer()

	if !s.allowEnroll("9.9.9.9") {
		t.Fatal("first enroll from an IP must be allowed")
	}
	if s.allowEnroll("9.9.9.9") {
		t.Error("second enroll inside the window must be rejected")
	}
	if !s.allowEnroll("8.8.8.8") {
		t.Error("a different IP must be independent")
	}

	// A rejection must not push the timestamp forward, so the window still
	// expires relative to the last ACCEPTED enroll.
	s.mu.Lock()
	last := s.enrollIP["9.9.9.9"]
	s.mu.Unlock()
	_ = s.allowEnroll("9.9.9.9") // rejected
	s.mu.Lock()
	after := s.enrollIP["9.9.9.9"]
	s.mu.Unlock()
	if !after.Equal(last) {
		t.Error("a rejected enroll must not extend the rate-limit window")
	}

	// Past the window, the same IP is allowed again.
	s.mu.Lock()
	s.enrollIP["9.9.9.9"] = time.Now().Add(-2 * enrollWindow)
	s.mu.Unlock()
	if !s.allowEnroll("9.9.9.9") {
		t.Error("enroll must be allowed once the window has elapsed")
	}
}
