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
		enrollIP:     make(map[string]*enrollBucket),
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
	// A drained bucket long enough ago to have fully refilled, vs one just spent.
	s.enrollIP["1.1.1.1"] = &enrollBucket{tokens: 0, last: now.Add(-time.Hour)}
	s.enrollIP["2.2.2.2"] = &enrollBucket{tokens: 0, last: now}

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
	// Spent 1s ago with nothing banked: only half a token has accrued.
	s.enrollIP["3.3.3.3"] = &enrollBucket{tokens: 0, last: now.Add(-time.Second)}

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

// Pins the bucket: a burst is available up front, the sustained rate holds
// after it, IPs are independent, and a REJECTED call is free.
func TestAllowEnrollBucket(t *testing.T) {
	s := newGCServer()

	// The whole burst is spendable back to back — this is the CGNAT case, where
	// thousands of mobile subscribers share one address and a fixed window
	// rejected everyone but the first to open the app.
	for i := 0; i < enrollBurst; i++ {
		if !s.allowEnroll("9.9.9.9") {
			t.Fatalf("enroll %d of the burst was rejected", i+1)
		}
	}
	if s.allowEnroll("9.9.9.9") {
		t.Error("the burst must not be exceeded — sustained abuse is still limited")
	}
	if !s.allowEnroll("8.8.8.8") {
		t.Error("a different IP must be independent")
	}

	// A rejection must not push recovery back: tokens accrue continuously, so
	// being turned away costs nothing.
	s.mu.Lock()
	before := s.enrollIP["9.9.9.9"].tokensAt(time.Now())
	s.mu.Unlock()
	_ = s.allowEnroll("9.9.9.9") // rejected
	s.mu.Lock()
	after := s.enrollIP["9.9.9.9"].tokensAt(time.Now())
	s.mu.Unlock()
	if after < before {
		t.Errorf("a rejected enroll consumed budget: %v -> %v", before, after)
	}

	// One window later exactly one more enroll is available, not a fresh burst.
	s.mu.Lock()
	s.enrollIP["9.9.9.9"] = &enrollBucket{tokens: 0, last: time.Now().Add(-enrollWindow)}
	s.mu.Unlock()
	if !s.allowEnroll("9.9.9.9") {
		t.Error("a refilled token must be spendable")
	}
	if s.allowEnroll("9.9.9.9") {
		t.Error("only one token accrues per window")
	}
}

// The bucket must not hand out more than the burst no matter how long an IP
// has been idle, or a dormant address would bank unlimited enrolls.
func TestAllowEnrollBurstIsCapped(t *testing.T) {
	s := newGCServer()
	s.mu.Lock()
	s.enrollIP["7.7.7.7"] = &enrollBucket{tokens: 0, last: time.Now().Add(-24 * time.Hour)}
	s.mu.Unlock()

	allowed := 0
	for i := 0; i < enrollBurst*4; i++ {
		if s.allowEnroll("7.7.7.7") {
			allowed++
		}
	}
	if allowed != enrollBurst {
		t.Errorf("a day-idle IP got %d enrolls, want the burst cap of %d", allowed, enrollBurst)
	}
}
