package entitle

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const snapPubKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="

// countingSource records how far back each scan reached, which is the whole
// point of the snapshot: a restart must not rescan from height 0.
type countingSource struct {
	txs    []Tx
	height int64
	afters []int64
}

func (c *countingSource) AddressTxs(_ context.Context, _ string, after int64) ([]Tx, error) {
	c.afters = append(c.afters, after)
	var out []Tx
	for _, tx := range c.txs {
		if tx.Height > after {
			out = append(out, tx)
		}
	}
	return out, nil
}
func (c *countingSource) BlockCount(_ context.Context) (int64, error) { return c.height, nil }

func snapSource(code string, now time.Time) *countingSource {
	return &countingSource{
		height: 500,
		txs: []Tx{
			{TxID: "a", Height: 10, Time: now, AmountTo: 20, Memos: []string{"CVPN1:" + code}},
		},
	}
}

func TestSnapshotResumesFromCursor(t *testing.T) {
	code := PaymentCode(snapPubKey)
	path := filepath.Join(t.TempDir(), "entitle.state")
	now := time.Now()

	first := New(snapSource(code, now), "t1Pay", 20)
	first.SetStatePath(path)
	if loaded, err := first.Load(); loaded || err != nil {
		t.Fatalf("cold start: loaded=%v err=%v, want false/nil", loaded, err)
	}
	if err := first.Backfill(context.Background()); err != nil {
		t.Fatalf("backfill: %v", err)
	}
	premium, until := first.Tier(snapPubKey)
	if !premium {
		t.Fatal("expected premium after backfill")
	}

	// Restart: same address and price, so the snapshot is usable.
	src2 := snapSource(code, now)
	second := New(src2, "t1Pay", 20)
	second.SetStatePath(path)
	loaded, err := second.Load()
	if err != nil || !loaded {
		t.Fatalf("restart load: loaded=%v err=%v, want true/nil", loaded, err)
	}
	premium2, until2 := second.Tier(snapPubKey)
	if !premium2 {
		t.Fatal("premium lost across restart")
	}
	if !until2.Equal(until.Truncate(time.Second)) {
		t.Fatalf("paid_until drifted: %v -> %v", until, until2)
	}
	if err := second.Backfill(context.Background()); err != nil {
		t.Fatalf("restart backfill: %v", err)
	}
	// The rescan must start at the stored cursor, not 0 — that is the entire
	// saving (thousands of sequential explorer pages on a busy address).
	if len(src2.afters) == 0 || src2.afters[0] != 500 {
		t.Fatalf("restart rescanned from %v, want cursor 500", src2.afters)
	}
}

func TestSnapshotDiscardedWhenParametersChange(t *testing.T) {
	code := PaymentCode(snapPubKey)
	dir := t.TempDir()
	now := time.Now()

	seed := func(path string) {
		e := New(snapSource(code, now), "t1Pay", 20)
		e.SetStatePath(path)
		if err := e.Backfill(context.Background()); err != nil {
			t.Fatalf("seed backfill: %v", err)
		}
	}

	// A repriced or repointed fleet changes what every historical tx granted,
	// so resuming from the old cursor would silently keep the old answers.
	cases := []struct {
		name    string
		address string
		price   float64
	}{
		{"different address", "t1Other", 20},
		{"different price", "t1Pay", 25},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(dir, tc.name+".state")
			seed(path)
			src := snapSource(code, now)
			e := New(src, tc.address, tc.price)
			e.SetStatePath(path)
			loaded, err := e.Load()
			if loaded {
				t.Fatal("stale snapshot was accepted")
			}
			if err == nil {
				t.Fatal("expected a reason for rejecting the snapshot")
			}
			// Rejecting means a clean slate: a full rescan from 0.
			if err := e.Backfill(context.Background()); err != nil {
				t.Fatalf("backfill: %v", err)
			}
			if src.afters[0] != 0 {
				t.Fatalf("rescanned from %d, want 0", src.afters[0])
			}
		})
	}
}

func TestSnapshotCorruptAndMissingAreNotFatal(t *testing.T) {
	dir := t.TempDir()

	t.Run("corrupt", func(t *testing.T) {
		path := filepath.Join(dir, "corrupt.state")
		if err := os.WriteFile(path, []byte("{not json"), 0o600); err != nil {
			t.Fatal(err)
		}
		e := New(&countingSource{height: 9}, "t1Pay", 20)
		e.SetStatePath(path)
		loaded, err := e.Load()
		if loaded || err == nil {
			t.Fatalf("corrupt snapshot: loaded=%v err=%v", loaded, err)
		}
		// ...and the engine is still usable, starting from scratch.
		if err := e.Backfill(context.Background()); err != nil {
			t.Fatalf("backfill after corrupt snapshot: %v", err)
		}
	})

	t.Run("no state path", func(t *testing.T) {
		e := New(&countingSource{height: 9}, "t1Pay", 20)
		loaded, err := e.Load()
		if loaded || err != nil {
			t.Fatalf("in-memory mode: loaded=%v err=%v", loaded, err)
		}
		if err := e.Save(); err != nil {
			t.Fatalf("Save without a path must be a no-op, got %v", err)
		}
	})
}

func TestSnapshotDropsExpiredCodes(t *testing.T) {
	code := PaymentCode(snapPubKey)
	path := filepath.Join(t.TempDir(), "entitle.state")

	// A payment old enough that its 30 days have already elapsed.
	stale := time.Now().Add(-90 * 24 * time.Hour)
	src := &countingSource{
		height: 500,
		txs:    []Tx{{TxID: "old", Height: 10, Time: stale, AmountTo: 20, Memos: []string{"CVPN1:" + code}}},
	}
	e := New(src, "t1Pay", 20)
	e.SetStatePath(path)
	if err := e.Backfill(context.Background()); err != nil {
		t.Fatalf("backfill: %v", err)
	}
	if premium, _ := e.Tier(snapPubKey); premium {
		t.Fatal("expired payment should not be premium")
	}

	// Expired entries behave exactly like absent ones under stack(), so they
	// are pruned rather than growing the file for the deployment's lifetime.
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(raw) == 0 {
		t.Fatal("snapshot not written")
	}
	if got := string(raw); strings.Contains(got, code) {
		t.Fatalf("expired code %q retained in snapshot: %s", code, got)
	}
}
