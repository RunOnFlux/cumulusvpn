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
	got := stack(time.Time{}, 30, now)
	if want := now.Add(period); !got.Equal(want) {
		t.Errorf("fresh: got %v want %v", got, want)
	}

	// Stacking on top of existing future time.
	future := now.Add(period)
	got = stack(future, 30, now)
	if want := now.Add(2 * period); !got.Equal(want) {
		t.Errorf("stack: got %v want %v", got, want)
	}

	// Expired past time resets base to now.
	past := now.Add(-100 * period)
	got = stack(past, 30, now)
	if want := now.Add(period); !got.Equal(want) {
		t.Errorf("expired base: got %v want %v", got, want)
	}

	// Overpayment: 3 periods at once.
	got = stack(time.Time{}, 90, now)
	if want := now.Add(3 * period); !got.Equal(want) {
		t.Errorf("multi: got %v want %v", got, want)
	}

	// Cap at 24 months of prepaid time.
	got = stack(now.Add(maxPrepaid), 1, now) // even one day past the cap truncates
	if want := now.Add(maxPrepaid); !got.Equal(want) {
		t.Errorf("cap: got %v want %v", got, want)
	}
	// Huge overpayment also capped.
	got = stack(time.Time{}, 3000, now)
	if want := now.Add(maxPrepaid); !got.Equal(want) {
		t.Errorf("cap-overpay: got %v want %v", got, want)
	}

	// Day-granular grants (voucher settlements).
	got = stack(time.Time{}, 1, now)
	if want := now.Add(day); !got.Equal(want) {
		t.Errorf("one day: got %v want %v", got, want)
	}
	got = stack(now.Add(day), 7, now)
	if want := now.Add(8 * day); !got.Equal(want) {
		t.Errorf("1d+7d stack: got %v want %v", got, want)
	}
	got = stack(now.Add(maxPrepaid-12*time.Hour), 45, now)
	if want := now.Add(maxPrepaid); !got.Equal(want) {
		t.Errorf("near-cap day grant truncates: got %v want %v", got, want)
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
			// sub-price: pro-rata days now — floor(30*1.0/4.5) = 6 days
			{TxID: "b", Height: 11, Time: now, AmountTo: 1.0, Memos: []string{"CVPN1:" + code}},
			// below one day's worth (price/30 = 0.15) -> ignored
			{TxID: "b2", Height: 11, Time: now, AmountTo: 0.1, Memos: []string{"CVPN1:" + code}},
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
	// 30 + 6 + 60 = 96 days of entitlement (the 1.0-FLUX tx now grants
	// pro-rata days instead of being ignored — the new semantics).
	wantMin := now.Add(96*day - time.Minute)
	wantMax := now.Add(96*day + time.Minute)
	if paidUntil.Before(wantMin) || paidUntil.After(wantMax) {
		t.Errorf("paidUntil = %v, want ~%v", paidUntil, wantMin)
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

// TestExactMultipleOverpayFloatEpsilon: a float sum equal to 3× the price that
// lands a hair below the integer (as real vout-value sums do) must still grant 3
// months, not truncate to 2. Regression for the missing epsilon in applyTxs.
func TestExactMultipleOverpayFloatEpsilon(t *testing.T) {
	const addr = "t1PayAddress"
	const price = 20.0
	pk := "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
	code := PaymentCode(pk)
	now := time.Now()
	src := &mockSource{height: 100, txs: []Tx{
		// 3×20 that the float representation renders as just-below-60.
		{TxID: "x", Height: 10, Time: now, AmountTo: 59.999999999999993, Memos: []string{"CVPN1:" + code}},
	}}
	e := New(src, addr, price)
	if err := e.Backfill(context.Background()); err != nil {
		t.Fatal(err)
	}
	premium, until := e.Tier(pk)
	if !premium {
		t.Fatal("expected premium")
	}
	// 3 months ≈ 90 days; 2 months would be ~60. Assert clearly in the 3-month band.
	if d := time.Until(until); d < 85*24*time.Hour {
		t.Errorf("exact 3× overpay granted only %v (want ~90 days = 3 months)", d)
	}
}

// TestBridgeFiatSettlement is the cross-language contract check with the
// payments bridge (bridge/, docs/18-payments-bridge.md): a bridge-settled
// monthly tx (1 x 20 FLUX) and annual tx (12 x 20 FLUX) carrying the memo
// the bridge builds for the all-zero fixture pubkey must grant exactly
// 1 + 12 months. The memo string here is byte-identical to the OP_RETURN
// payload in the bridge's golden tx test (bridge/test/tx.test.ts) and the
// fluxnode decodeOpReturn bridge-fixture test.
func TestBridgeFiatSettlement(t *testing.T) {
	const addr = "t3disq3aZz8K3RLZL9zfkpP2UWNVV3hq4vZ"
	const price = 20.0

	pk := "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
	if got := PaymentCode(pk); got != "2RkUfDC55GMndKreXqK7Jruu8Snx" {
		t.Fatalf("fixture drift: PaymentCode = %q, want 2RkUfDC55GMndKreXqK7Jruu8Snx", got)
	}
	const memo = "CVPN1:2RkUfDC55GMndKreXqK7Jruu8Snx"

	now := time.Now()
	src := &mockSource{
		height: 100,
		txs: []Tx{
			// bridge monthly settlement: exactly price -> +30 days
			{TxID: "fiat-m", Height: 10, Time: now, AmountTo: 20.0, Memos: []string{memo}},
			// bridge annual settlement: 12 x price in ONE tx -> +360 days
			{TxID: "fiat-a", Height: 11, Time: now, AmountTo: 240.0, Memos: []string{memo}},
		},
	}

	e := New(src, addr, price)
	if err := e.Backfill(context.Background()); err != nil {
		t.Fatalf("backfill: %v", err)
	}
	premium, paidUntil := e.Tier(pk)
	if !premium {
		t.Fatal("bridge-settled payments did not grant premium")
	}
	got := paidUntil.Sub(now)
	want := 13 * 30 * 24 * time.Hour
	if got < want-time.Hour || got > want+time.Hour {
		t.Fatalf("paid_until = now+%v, want ~%v (1 monthly + 12 annual months)", got, want)
	}
}

// TestProRataDayGrants pins the day-granular rule against the EXACT amounts
// the bridge broadcasts for voucher settlements: zats = ceil(priceZats*d/30),
// which round-trip through the explorer as the float FLUX values below. A
// 1-zat-short amount must reject — the ceil on the payer side and the epsilon
// here are calibrated so the floor never truncates a funded grant and never
// promotes an underfunded one.
func TestProRataDayGrants(t *testing.T) {
	const addr = "t3disq3aZz8K3RLZL9zfkpP2UWNVV3hq4vZ"
	const price = 20.0
	const memo = "CVPN1:2RkUfDC55GMndKreXqK7Jruu8Snx"
	pk := "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="

	cases := []struct {
		name   string
		amount float64 // FLUX, as the insight API reports the zat value
		days   int     // 0 = rejected
	}{
		{"one day (ceil 66_666_667 zats)", 0.66666667, 1},
		{"one zat short of a day", 0.66666666, 0},
		{"three days (exact 2 FLUX)", 2.0, 3},
		{"seven days (ceil 466_666_667 zats)", 4.66666667, 7},
		{"thirty days (exactly price)", 20.0, 30},
		{"annual (12x price)", 240.0, 360},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			now := time.Now()
			src := &mockSource{height: 10, txs: []Tx{
				{TxID: "v", Height: 5, Time: now, AmountTo: tc.amount, Memos: []string{memo}},
			}}
			e := New(src, addr, price)
			if err := e.Backfill(context.Background()); err != nil {
				t.Fatal(err)
			}
			premium, paidUntil := e.Tier(pk)
			if tc.days == 0 {
				if premium {
					t.Fatalf("amount %v should be rejected, got premium until %v", tc.amount, paidUntil)
				}
				return
			}
			if !premium {
				t.Fatalf("amount %v should grant %d day(s)", tc.amount, tc.days)
			}
			got := paidUntil.Sub(now)
			want := time.Duration(tc.days) * day
			if got < want-time.Minute || got > want+time.Minute {
				t.Fatalf("amount %v: paid_until = now+%v, want ~%v", tc.amount, got, want)
			}
		})
	}
}
