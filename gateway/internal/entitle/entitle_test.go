package entitle

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestMemoParse(t *testing.T) {
	cases := []struct {
		name    string
		memos   []string
		want    string
		wantErr error
	}{
		{"single valid", []string{"CVPN1:3QJmnh8vzBqoQpuTGDsUCkbFyxVQ"}, "3QJmnh8vzBqoQpuTGDsUCkbFyxVQ", nil},
		{"ignores other memos", []string{"hello world", "CVPN1:abc123"}, "abc123", nil},
		{"trims whitespace", []string{"CVPN1: xyz "}, "xyz", nil},
		{"no memo", []string{"random", "not ours"}, "", ErrNoMemo},
		{"empty list", nil, "", ErrNoMemo},
		{"empty code", []string{"CVPN1:"}, "", ErrBadCode},
		{"multiple cvpn", []string{"CVPN1:a", "CVPN1:b"}, "", ErrMultiMemo},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := MemoParse(tc.memos)
			if got != tc.want {
				t.Errorf("code = %q, want %q", got, tc.want)
			}
			if !errors.Is(err, tc.wantErr) {
				t.Errorf("err = %v, want %v", err, tc.wantErr)
			}
		})
	}
}

func TestPaymentCodeDeterministic(t *testing.T) {
	// 32 zero bytes -> stable base64 pubkey.
	pk := "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
	a := PaymentCode(pk)
	b := PaymentCode(pk)
	if a == "" || a != b {
		t.Fatalf("PaymentCode not deterministic/non-empty: %q %q", a, b)
	}
	if PaymentCode("not-base64!!") != "" {
		t.Error("expected empty code for malformed key")
	}
	if PaymentCode("QQ==") != "" { // wrong length
		t.Error("expected empty code for wrong-length key")
	}
}

func TestStackingAndCap(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	// Fresh payment: 30 days from now.
	got := stack(time.Time{}, 1, now)
	if want := now.Add(period); !got.Equal(want) {
		t.Errorf("fresh: got %v want %v", got, want)
	}

	// Stacking on top of existing future time.
	future := now.Add(period)
	got = stack(future, 1, now)
	if want := now.Add(2 * period); !got.Equal(want) {
		t.Errorf("stack: got %v want %v", got, want)
	}

	// Expired past time resets base to now.
	past := now.Add(-100 * period)
	got = stack(past, 1, now)
	if want := now.Add(period); !got.Equal(want) {
		t.Errorf("expired base: got %v want %v", got, want)
	}

	// Overpayment: 3 periods at once.
	got = stack(time.Time{}, 3, now)
	if want := now.Add(3 * period); !got.Equal(want) {
		t.Errorf("multi: got %v want %v", got, want)
	}

	// Cap at 24 months of prepaid time.
	got = stack(now.Add(maxPrepaid), 1, now)
	if want := now.Add(maxPrepaid); !got.Equal(want) {
		t.Errorf("cap: got %v want %v", got, want)
	}
	// Huge overpayment also capped.
	got = stack(time.Time{}, 100, now)
	if want := now.Add(maxPrepaid); !got.Equal(want) {
		t.Errorf("cap-overpay: got %v want %v", got, want)
	}
}

// mockSource implements TxSource for the end-to-end applyTxs test.
type mockSource struct {
	txs    []Tx
	height int64
}

func (m *mockSource) AddressTxs(_ context.Context, _ string, after int64) ([]Tx, error) {
	var out []Tx
	for _, tx := range m.txs {
		if tx.Height > after {
			out = append(out, tx)
		}
	}
	return out, nil
}
func (m *mockSource) BlockCount(_ context.Context) (int64, error) { return m.height, nil }

func TestEngineBackfillAndTier(t *testing.T) {
	const addr = "t1PayAddress"
	const price = 4.5

	pk := "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
	code := PaymentCode(pk)

	now := time.Now()
	src := &mockSource{
		height: 100,
		txs: []Tx{
			// valid, single month
			{TxID: "a", Height: 10, Time: now, AmountTo: 4.5, Memos: []string{"CVPN1:" + code}},
			// underpaid -> ignored
			{TxID: "b", Height: 11, Time: now, AmountTo: 1.0, Memos: []string{"CVPN1:" + code}},
			// overpaid 2x -> +60 days on top
			{TxID: "c", Height: 12, Time: now, AmountTo: 9.0, Memos: []string{"CVPN1:" + code}},
			// no memo -> ignored
			{TxID: "d", Height: 13, Time: now, AmountTo: 4.5, Memos: nil},
		},
	}

	e := New(src, addr, price)
	flips := 0
	e.OnChange(func(_ string, premium bool) {
		if premium {
			flips++
		}
	})
	if err := e.Backfill(context.Background()); err != nil {
		t.Fatal(err)
	}

	premium, paidUntil := e.Tier(pk)
	if !premium {
		t.Fatal("expected premium after valid payments")
	}
	// 1 + 2 = 3 periods of entitlement.
	wantMin := now.Add(3*period - time.Minute)
	if paidUntil.Before(wantMin) {
		t.Errorf("paidUntil = %v, want >= ~%v", paidUntil, wantMin)
	}
	if flips != 1 {
		t.Errorf("expected exactly one premium flip, got %d", flips)
	}

	// An unpaid key is free.
	other := "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE="
	if p, _ := e.Tier(other); p {
		t.Error("unpaid key should be free")
	}
}
