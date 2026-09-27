package entitle

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// scriptedSource serves a history the test mutates between scans, recording
// how far back each read reached.
type scriptedSource struct {
	height int64
	txs    []Tx
	afters []int64
}

func (s *scriptedSource) BlockCount(context.Context) (int64, error) { return s.height, nil }
func (s *scriptedSource) AddressTxs(_ context.Context, _ string, after int64) ([]Tx, error) {
	s.afters = append(s.afters, after)
	var out []Tx
	for _, tx := range s.txs {
		if tx.Height > after {
			out = append(out, tx)
		}
	}
	return out, nil
}

func pay(id string, h int64, amount float64, now time.Time) Tx {
	return Tx{TxID: id, Height: h, Time: now, AmountTo: amount, Memos: []string{"CVPN1:" + PaymentCode(snapPubKey)}}
}

func paidDays(t *testing.T, e *Engine, now time.Time) int {
	t.Helper()
	_, until := e.Tier(snapPubKey)
	if until.IsZero() {
		return 0
	}
	return int((until.Sub(now) + time.Minute) / day)
}

// TestExplorerLagIsRecovered: the height comes from the host daemon, the
// history from an explorer that can be a block behind it. A payment in a
// block the explorer had not indexed yet must still be granted once it is.
func TestExplorerLagIsRecovered(t *testing.T) {
	now := time.Now()
	src := &scriptedSource{height: 100}
	e := New(src, "t1Pay", flat(20))
	if err := e.Backfill(context.Background()); err != nil {
		t.Fatal(err)
	}
	src.height = 101 // block 101 carries a payment the explorer has not indexed
	e.poll(context.Background())
	src.txs = []Tx{pay("late", 101, 20, now)} // indexed now; cursor already at 101
	src.height = 102
	e.poll(context.Background())
	src.height = 103
	e.poll(context.Background())
	if d := paidDays(t, e, now); d != 30 {
		t.Fatalf("lagged payment granted %d days, want exactly 30", d)
	}
}

// TestReorgedTxIsNotGrantedTwice: a tx folded at one height and re-mined at
// the next by a shallow reorg keeps its txid.
func TestReorgedTxIsNotGrantedTwice(t *testing.T) {
	now := time.Now()
	src := &scriptedSource{height: 100, txs: []Tx{pay("r", 100, 20, now)}}
	e := New(src, "t1Pay", flat(20))
	if err := e.Backfill(context.Background()); err != nil {
		t.Fatal(err)
	}
	src.txs = []Tx{pay("r", 101, 20, now)}
	src.height = 101
	e.poll(context.Background())
	if d := paidDays(t, e, now); d != 30 {
		t.Fatalf("reorged tx granted %d days, want 30", d)
	}
}

// TestUnconfirmedTxIsIgnoredUntilMined: height <= 0 is mempool.
func TestUnconfirmedTxIsIgnoredUntilMined(t *testing.T) {
	now := time.Now()
	src := &scriptedSource{height: 100, txs: []Tx{pay("m", -1, 20, now)}}
	e := New(src, "t1Pay", flat(20))
	if err := e.Backfill(context.Background()); err != nil {
		t.Fatal(err)
	}
	if d := paidDays(t, e, now); d != 0 {
		t.Fatalf("unconfirmed tx granted %d days", d)
	}
	src.txs = []Tx{pay("m", 101, 20, now)}
	src.height = 101
	e.poll(context.Background())
	if d := paidDays(t, e, now); d != 30 {
		t.Fatalf("mined tx granted %d days, want 30", d)
	}
}

// TestRestartWithOverlapDoesNotRegrant: the overlap re-reads folded txs after
// a restart; the persisted seen set is what keeps them from counting twice.
func TestRestartWithOverlapDoesNotRegrant(t *testing.T) {
	now := time.Now()
	path := filepath.Join(t.TempDir(), "entitle.state")
	src := &scriptedSource{height: 500, txs: []Tx{pay("near", 490, 20, now)}}
	first := New(src, "t1Pay", flat(20))
	first.SetStatePath(path)
	if err := first.Backfill(context.Background()); err != nil {
		t.Fatal(err)
	}
	second := New(src, "t1Pay", flat(20))
	second.SetStatePath(path)
	if loaded, err := second.Load(); !loaded || err != nil {
		t.Fatalf("load: %v %v", loaded, err)
	}
	if err := second.Backfill(context.Background()); err != nil {
		t.Fatal(err)
	}
	if last := src.afters[len(src.afters)-1]; last != 500-overlapBlocks {
		t.Fatalf("restart read from %d, want the overlap %d", last, 500-overlapBlocks)
	}
	if d := paidDays(t, second, now); d != 30 {
		t.Fatalf("restart re-granted: %d days, want 30", d)
	}
}

// TestPreOverlapSnapshotUsesItsCursorAsFloor: a snapshot without a seen set
// cannot dedupe an overlap, so the first scan must not reach below it.
func TestPreOverlapSnapshotUsesItsCursorAsFloor(t *testing.T) {
	path := filepath.Join(t.TempDir(), "entitle.state")
	legacy, _ := json.Marshal(map[string]any{
		"version": snapshotVersion, "address": "t1Pay", "price_flux": 20,
		"last_block": 500, "paid_until": map[string]int64{},
	})
	if err := os.WriteFile(path, legacy, 0o600); err != nil {
		t.Fatal(err)
	}
	src := &scriptedSource{height: 510}
	e := New(src, "t1Pay", flat(20))
	e.SetStatePath(path)
	if loaded, err := e.Load(); !loaded || err != nil {
		t.Fatalf("load: %v %v", loaded, err)
	}
	if err := e.Backfill(context.Background()); err != nil {
		t.Fatal(err)
	}
	if src.afters[0] != 500 {
		t.Fatalf("first scan read from %d, want the legacy cursor 500", src.afters[0])
	}
}

// TestLateRepriceRebuildRefusesTruncatedHistory: a rebuild that cannot see a
// tx it already folded (a truncated or empty history read) must not replace
// — and persist — the map.
func TestLateRepriceRebuildRefusesTruncatedHistory(t *testing.T) {
	now := time.Now()
	src := &scriptedSource{height: 500, txs: []Tx{pay("recent", 490, 20, now)}}
	e := New(src, "t1Pay", flat(20))
	if err := e.Backfill(context.Background()); err != nil {
		t.Fatal(err)
	}
	src.txs = nil                             // the history source now returns nothing
	e.Reprice(mustSchedule(t, "20@0,12@400")) // reached this node late: needs a rebuild
	e.applyPending(context.Background())
	if d := paidDays(t, e, now); d != 30 {
		t.Fatalf("truncated rebuild replaced the map: %d days, want 30", d)
	}
	if got := e.Schedule().String(); got != "20@0" {
		t.Fatalf("schedule swapped to %s despite the failed rebuild", got)
	}
	if e.pending.Load() == nil {
		t.Fatal("a failed rebuild must stay pending for a retry")
	}
	// History readable again: the retry succeeds, judging the tx at 12.
	src.txs = []Tx{pay("recent", 490, 20, now)}
	e.applyPending(context.Background())
	if got := e.Schedule().String(); got != "20@0,12@400" {
		t.Fatalf("schedule = %s after the retry", got)
	}
	if d := paidDays(t, e, now); d != 50 {
		t.Fatalf("rebuilt grant = %d days, want 50 (20 FLUX at 12)", d)
	}
}

// TestHistoryEditIsNotHotApplied: a spec that changes existing entries would
// re-judge every past payment fleet-wide within minutes; it waits for a
// redeploy instead.
func TestHistoryEditIsNotHotApplied(t *testing.T) {
	src := &scriptedSource{height: 500}
	e := New(src, "t1Pay", mustSchedule(t, "20@0,12@400"))
	if err := e.Backfill(context.Background()); err != nil {
		t.Fatal(err)
	}
	e.Reprice(flat(12))
	e.applyPending(context.Background())
	if got := e.Schedule().String(); got != "20@0,12@400" {
		t.Fatalf("history edit was hot-applied: %s", got)
	}
}

// TestQuoteNeverUndersellsBeforeTheHeightIsKnown: quoting a scheduled drop
// early would sell a month for a fraction of one.
func TestQuoteNeverUndersellsBeforeTheHeightIsKnown(t *testing.T) {
	src := &scriptedSource{height: 900}
	e := New(src, "t1Pay", mustSchedule(t, "20@0,12@1000"))
	if q := e.Quote(); q != 20 {
		t.Fatalf("quote before any scan = %v, want the higher 20", q)
	}
	if err := e.Backfill(context.Background()); err != nil {
		t.Fatal(err)
	}
	if q := e.Quote(); q != 20 {
		t.Fatalf("quote at 900 = %v, want 20", q)
	}
	src.height = 1000
	e.poll(context.Background())
	if q := e.Quote(); q != 12 {
		t.Fatalf("quote at 1000 = %v, want 12", q)
	}
}
