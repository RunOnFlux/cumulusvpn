package entitle

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/runonflux/cumulusvpn-gateway/internal/price"
)

func mustSchedule(t *testing.T, s string) price.Schedule {
	t.Helper()
	sch, err := price.Parse(s)
	if err != nil {
		t.Fatal(err)
	}
	return sch
}

// daysGranted runs one tx through a fresh engine and returns the whole days
// it granted (0 = rejected).
func daysGranted(t *testing.T, sched price.Schedule, height int64, amount float64) int {
	t.Helper()
	now := time.Now()
	src := &mockSource{height: height + 1, txs: []Tx{
		{TxID: "x", Height: height, Time: now, AmountTo: amount, Memos: []string{"CVPN1:" + PaymentCode(snapPubKey)}},
	}}
	e := New(src, "t1Pay", sched)
	if err := e.Backfill(context.Background()); err != nil {
		t.Fatal(err)
	}
	premium, until := e.Tier(snapPubKey)
	if !premium {
		return 0
	}
	return int((until.Sub(now) + time.Minute) / day)
}

// TestRepriceIsProspective is the point of the schedule: a price change
// applies from its height on and never re-judges a tx mined before it.
func TestRepriceIsProspective(t *testing.T) {
	s := mustSchedule(t, "20@0,12@1000")
	cases := []struct {
		name   string
		height int64
		amount float64
		days   int
	}{
		{"old month before the drop keeps 30 days", 500, 20, 30},
		{"new price after the drop buys a month", 1500, 12, 30},
		{"old quote paid after the drop is worth more", 1500, 20, 50},
		{"new price before the drop is pro-rata at the old one", 500, 12, 18},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := daysGranted(t, s, tc.height, tc.amount); got != tc.days {
				t.Fatalf("got %d days, want %d", got, tc.days)
			}
		})
	}
}

// TestRiseHonoursOldPriceDuringGrace: someone quoted the old, lower price just
// before a rise still gets a full month if their tx lands inside the window.
func TestRiseHonoursOldPriceDuringGrace(t *testing.T) {
	s := mustSchedule(t, "12@0,16@1000")
	if got := daysGranted(t, s, 1000+100, 12); got != 30 {
		t.Fatalf("old price inside grace: %d days, want 30", got)
	}
	if got := daysGranted(t, s, 1000+price.GraceBlocks, 12); got != 22 {
		t.Fatalf("old price after grace: %d days, want floor(30*12/16)=22", got)
	}
	if got := daysGranted(t, s, 1000+price.GraceBlocks, 16); got != 30 {
		t.Fatalf("new price after grace: %d days, want 30", got)
	}
}

// racingSource returns a tx one block ABOVE the height it reports, as a real
// explorer does when a block lands between getblockcount and the history read.
type racingSource struct {
	height int64
	txs    []Tx
}

func (r *racingSource) BlockCount(context.Context) (int64, error) { return r.height, nil }
func (r *racingSource) AddressTxs(_ context.Context, _ string, after int64) ([]Tx, error) {
	var out []Tx
	for _, tx := range r.txs {
		if tx.Height > after {
			out = append(out, tx)
		}
	}
	return out, nil
}

// TestTxAboveCursorIsGrantedExactlyOnce: stack() adds days on every
// application, so a tx folded by one poll must never be returned to the next.
func TestTxAboveCursorIsGrantedExactlyOnce(t *testing.T) {
	now := time.Now()
	src := &racingSource{height: 100, txs: []Tx{
		{TxID: "late", Height: 101, Time: now, AmountTo: 20, Memos: []string{"CVPN1:" + PaymentCode(snapPubKey)}},
	}}
	e := New(src, "t1Pay", flat(20))
	if err := e.Backfill(context.Background()); err != nil {
		t.Fatal(err)
	}
	if p, _ := e.Tier(snapPubKey); p {
		t.Fatal("a tx above the reported height was applied before the cursor reached it")
	}
	src.height = 101
	e.poll(context.Background())
	src.height = 102
	e.poll(context.Background())
	_, until := e.Tier(snapPubKey)
	if d := until.Sub(now); d < 29*day || d > 31*day {
		t.Fatalf("paid_until = now+%v, want one 30-day grant", d)
	}
}

func TestSnapshotSurvivesAppendedEntryAboveCursor(t *testing.T) {
	code := PaymentCode(snapPubKey)
	path := filepath.Join(t.TempDir(), "entitle.state")
	now := time.Now()

	first := New(snapSource(code, now), "t1Pay", flat(20)) // cursor lands at 500
	first.SetStatePath(path)
	if err := first.Backfill(context.Background()); err != nil {
		t.Fatal(err)
	}

	// A reprice starting above the cursor re-judges nothing: keep the snapshot.
	src := snapSource(code, now)
	e := New(src, "t1Pay", mustSchedule(t, "20@0,12@600"))
	e.SetStatePath(path)
	if loaded, err := e.Load(); !loaded || err != nil {
		t.Fatalf("appended schedule: loaded=%v err=%v, want true/nil", loaded, err)
	}

	// One starting at/below the cursor would change folded grants: rescan.
	e2 := New(snapSource(code, now), "t1Pay", mustSchedule(t, "20@0,12@400"))
	e2.SetStatePath(path)
	if loaded, _ := e2.Load(); loaded {
		t.Fatal("a schedule entry below the cursor must discard the snapshot")
	}
}

func TestLegacySnapshotReadsAsFlatSchedule(t *testing.T) {
	path := filepath.Join(t.TempDir(), "entitle.state")
	legacy, _ := json.Marshal(map[string]any{
		"version": snapshotVersion, "address": "t1Pay", "price_flux": 20,
		"last_block": 500, "paid_until": map[string]int64{},
	})
	if err := os.WriteFile(path, legacy, 0o600); err != nil {
		t.Fatal(err)
	}
	e := New(&countingSource{height: 500}, "t1Pay", mustSchedule(t, "20@0,12@501"))
	e.SetStatePath(path)
	if loaded, err := e.Load(); !loaded || err != nil {
		t.Fatalf("pre-schedule snapshot: loaded=%v err=%v, want true/nil", loaded, err)
	}
	// Written back with the schedule, so the next boot compares like with like.
	if err := e.Save(); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(path)
	var s snapshot
	_ = json.Unmarshal(raw, &s)
	// price_flux is 0 for a multi-entry schedule so a rolled-back image rejects
	// the file (and rescans like its peers) instead of resuming from it.
	if s.PriceSchedule != "20@0,12@501" || s.PriceFlux != 0 {
		t.Fatalf("saved schedule=%q price=%v", s.PriceSchedule, s.PriceFlux)
	}
}

// TestHotReprice: the hot-reload path must behave like a
// restart with the new spec, but only pay for a rescan when history changes.
func TestHotReprice(t *testing.T) {
	code := PaymentCode(snapPubKey)
	now := time.Now()
	ctx := context.Background()

	t.Run("extension above cursor swaps in place", func(t *testing.T) {
		src := snapSource(code, now) // one 20-FLUX tx at height 10, tip 500
		e := New(src, "t1Pay", flat(20))
		if err := e.Backfill(ctx); err != nil {
			t.Fatal(err)
		}
		scans := len(src.afters)
		e.Reprice(mustSchedule(t, "20@0,12@501"))
		e.applyPending(ctx)
		if len(src.afters) != scans {
			t.Fatalf("an appended entry above the cursor triggered a rescan")
		}
		if got := e.Schedule().String(); got != "20@0,12@501" {
			t.Fatalf("schedule = %s", got)
		}
		if q := e.Quote(); q != 12 {
			t.Fatalf("quote = %v, want the new price from the next block", q)
		}
	})

	t.Run("entry below cursor rebuilds from height 0", func(t *testing.T) {
		src := snapSource(code, now)
		e := New(src, "t1Pay", flat(20))
		if err := e.Backfill(ctx); err != nil {
			t.Fatal(err)
		}
		// The spec reached this node late: the drop to 10 started at 5, below
		// the 20-FLUX tx at 10, so that tx is now worth 60 days.
		e.Reprice(mustSchedule(t, "20@0,10@5"))
		e.applyPending(ctx)
		if last := src.afters[len(src.afters)-1]; last != 0 {
			t.Fatalf("rebuild scanned from %d, want 0", last)
		}
		_, until := e.Tier(snapPubKey)
		if d := until.Sub(now); d < 59*day || d > 61*day {
			t.Fatalf("rebuilt paid_until = now+%v, want ~60 days", d)
		}
	})

	t.Run("an invalid schedule is ignored", func(t *testing.T) {
		e := New(snapSource(code, now), "t1Pay", flat(20))
		e.Reprice(price.Schedule{})
		e.applyPending(ctx)
		if got := e.Schedule().String(); got != "20@0" {
			t.Fatalf("schedule = %s", got)
		}
	})
}
