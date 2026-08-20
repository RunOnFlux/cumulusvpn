// Package entitle is the chain scanner: it derives the premium-entitlement
// state purely from Flux blockchain facts (docs/04-payments.md). Every
// gateway runs the same deterministic scan and therefore reaches the same
// paid_until map — a payment made once unlocks premium on every gateway with
// no server-to-server coordination.
//
// Protocol (docs/04-payments.md):
//   - identity is the client's WireGuard pubkey K (32 bytes)
//   - the OP_RETURN memo carries CVPN1:<code> where
//     code = base58(sha256(K)[0:20])
//   - a tx grants entitlement iff it pays >= priceFlux/30 (one day's worth)
//     to the payment address with exactly one valid CVPN1 memo and >= 1
//     confirmation
//   - effect: paid_until[code] = max(now, paid_until[code]) + days, where
//     days = floor(30 * amount / priceFlux) — pro-rata by the day, so whole
//     multiples of the price grant whole 30-day months exactly as before,
//     and fractional amounts (voucher settlements, docs/18) grant days.
//     Stacking, capped at +24 months of prepaid time.
package entitle

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"log"
	"strings"
	"sync"
	"time"
)

const (
	memoPrefix   = "CVPN1:"
	day          = 24 * time.Hour
	period       = 30 * day
	maxPrepaid   = 24 * period // cap: 24 months (720 days) of prepaid time from now
	pollInterval = 15 * time.Second
	// saveInterval throttles cursor-only snapshot writes; a poll that actually
	// granted entitlement checkpoints immediately regardless.
	saveInterval = time.Minute
)

// TxSource is the minimal chain interface entitle needs. internal/fluxnode's
// Client satisfies it; tests use a mock (see entitle_test.go).
type TxSource interface {
	// AddressTxs returns txs paying the address, oldest-first, height > after.
	AddressTxs(ctx context.Context, addr string, afterHeight int64) ([]Tx, error)
	// BlockCount returns the current chain height.
	BlockCount(ctx context.Context) (int64, error)
}

// Tx is a normalized transaction (decouples entitle from fluxnode types).
type Tx struct {
	TxID     string
	Height   int64
	Time     time.Time
	AmountTo float64  // total paid to the payment address
	Memos    []string // decoded OP_RETURN payloads
}

// Engine holds the derived paid_until map keyed by payment code.
type Engine struct {
	src       TxSource
	address   string
	priceFlux float64

	mu        sync.RWMutex
	paidUntil map[string]time.Time // code -> paid_until
	lastBlock int64

	// statePath, when set, persists paidUntil+lastBlock across restarts so a
	// redeploy resumes from the stored cursor instead of replaying the whole
	// payment history. See snapshot.go — it is a cache, never a source of
	// truth. dirty marks state the current file does not yet reflect.
	statePath string
	dirty     bool
	lastSaved time.Time

	// onChange is called (code, premium) whenever a code's tier flips, so
	// the limiter can be retuned. Set via OnChange before Start.
	onChange func(code string, premium bool)
}

// New builds an Engine. address and priceFlux come from config.
func New(src TxSource, address string, priceFlux float64) *Engine {
	return &Engine{
		src:       src,
		address:   address,
		priceFlux: priceFlux,
		paidUntil: make(map[string]time.Time),
	}
}

// OnChange registers a tier-flip callback (code, premium).
func (e *Engine) OnChange(fn func(code string, premium bool)) {
	e.onChange = fn
}

// PaymentCode derives the memo payment code for a base64 WireGuard pubkey:
// base58(sha256(K)[0:20]). Returns "" if the key is malformed.
func PaymentCode(pubkeyB64 string) string {
	raw, err := base64.StdEncoding.DecodeString(pubkeyB64)
	if err != nil || len(raw) != 32 {
		return ""
	}
	sum := sha256.Sum256(raw)
	return base58Encode(sum[:20])
}

// Tier reports whether a pubkey is currently premium and until when.
func (e *Engine) Tier(pubkeyB64 string) (premium bool, paidUntil time.Time) {
	code := PaymentCode(pubkeyB64)
	if code == "" {
		return false, time.Time{}
	}
	e.mu.RLock()
	defer e.mu.RUnlock()
	pu := e.paidUntil[code]
	return pu.After(time.Now()), pu
}

// Backfill scans the payment-address history at boot, starting from the
// cursor a loaded snapshot left behind (0 — the full history — when there is
// none). Re-scanning from a snapshot cursor is safe by construction: grants
// only ever extend paid_until, and every tx is idempotent under `stack`.
func (e *Engine) Backfill(ctx context.Context) error {
	e.mu.RLock()
	from := e.lastBlock
	e.mu.RUnlock()
	txs, err := e.src.AddressTxs(ctx, e.address, from)
	if err != nil {
		return err
	}
	e.applyTxs(txs)
	if h, err := e.src.BlockCount(ctx); err == nil {
		e.mu.Lock()
		e.lastBlock = h
		e.dirty = true
		e.mu.Unlock()
	}
	if err := e.Save(); err != nil {
		// Losing the snapshot costs a rescan next boot, nothing more.
		log.Printf("entitle: snapshot save: %v", err)
	}
	return nil
}

// Run polls getblockcount every 15s and scans new blocks' payment txs until
// ctx is cancelled. Deterministic from chain state.
func (e *Engine) Run(ctx context.Context) {
	t := time.NewTicker(pollInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			// A clean shutdown is the cheapest moment to checkpoint: a Flux
			// app update redeploys every container, and the cursor saved here
			// is what turns the next boot into an incremental catch-up.
			if err := e.Save(); err != nil {
				log.Printf("entitle: snapshot save on shutdown: %v", err)
			}
			return
		case <-t.C:
			e.poll(ctx)
			e.maybeSave()
		}
	}
}

// maybeSave checkpoints at most once a minute. The cursor advances on nearly
// every poll, so writing each time would mean four disk writes a minute
// forever for state that only costs a rescan to rebuild. Grants are the part
// worth keeping promptly, and applyTxs saves those immediately.
func (e *Engine) maybeSave() {
	e.mu.RLock()
	dirty, since := e.dirty, time.Since(e.lastSaved)
	e.mu.RUnlock()
	if !dirty || since < saveInterval {
		return
	}
	if err := e.Save(); err != nil {
		log.Printf("entitle: snapshot save: %v", err)
	}
}

func (e *Engine) poll(ctx context.Context) {
	height, err := e.src.BlockCount(ctx)
	if err != nil {
		log.Printf("entitle: blockcount: %v", err)
		return
	}
	e.mu.RLock()
	last := e.lastBlock
	e.mu.RUnlock()
	if height <= last {
		return
	}
	txs, err := e.src.AddressTxs(ctx, e.address, last)
	if err != nil {
		log.Printf("entitle: address txs: %v", err)
		return
	}
	granted := e.applyTxs(txs)
	e.mu.Lock()
	e.lastBlock = height
	e.dirty = true
	e.mu.Unlock()
	// Real entitlement changed — checkpoint now rather than waiting out the
	// throttle, so a crash in the next minute cannot lose a paid grant's
	// cursor and serve that user free until the rescan catches up.
	if granted > 0 {
		if err := e.Save(); err != nil {
			log.Printf("entitle: snapshot save: %v", err)
		}
	}
}

// applyTxs folds a batch of (oldest-first) txs into the paid_until map.
// Returns the number of grants applied, so callers can checkpoint the
// snapshot promptly when real entitlement changed.
func (e *Engine) applyTxs(txs []Tx) int {
	granted := 0
	for _, tx := range txs {
		code, ok := ValidPayment(tx, e.address, e.priceFlux)
		if !ok {
			continue
		}
		// Pro-rata by the day: days = floor(30 * amount / price). Whole
		// multiples of the price grant whole 30-day months exactly as the
		// original months rule did ("pay 3x -> 90 days"); fractional amounts
		// (bridge voucher settlements, docs/18 — sized ceil(price*days/30) in
		// zats so this floor never truncates) grant days. AmountTo is a
		// float64 sum of vout values, so an exact multiple can land a hair
		// below the integer — the same epsilon ValidPayment uses keeps
		// 59.999… at 90 days, not 89.
		days := int(30 * (tx.AmountTo + 1e-9) / e.priceFlux)
		if days < 1 {
			continue // ValidPayment already rejects; belt and braces
		}

		e.mu.Lock()
		wasPremium := e.paidUntil[code].After(time.Now())
		e.paidUntil[code] = stack(e.paidUntil[code], days, tx.Time)
		nowPremium := e.paidUntil[code].After(time.Now())
		e.dirty = true
		e.mu.Unlock()
		granted++

		if !wasPremium && nowPremium && e.onChange != nil {
			e.onChange(code, true)
		}
	}
	return granted
}

// stack applies a grant of `days` on top of an existing paid_until, capping
// the result at now + maxPrepaid. `now` is passed in for deterministic tests.
func stack(current time.Time, days int, now time.Time) time.Time {
	base := current
	if base.Before(now) {
		base = now
	}
	result := base.Add(time.Duration(days) * day)
	if cap := now.Add(maxPrepaid); result.After(cap) {
		result = cap
	}
	return result
}

// ValidPayment reports whether tx is a valid CVPN payment to address at
// priceFlux, returning the payment code from its memo. A valid tx must:
//   - pay >= priceFlux/30 (one day's worth) to address, and
//   - carry exactly one CVPN1: memo with a non-empty code.
//
// Confirmation depth is enforced by the caller's tx source (AddressTxs only
// returns confirmed txs); the optional 0-conf fast path lives elsewhere.
func ValidPayment(tx Tx, address string, priceFlux float64) (code string, ok bool) {
	// Kept in multiplied form (30*amount < price) to avoid a division.
	if 30*(tx.AmountTo+1e-9) < priceFlux {
		return "", false
	}
	c, err := MemoParse(tx.Memos)
	if err != nil {
		return "", false
	}
	return c, true
}

// ErrNoMemo / ErrMultiMemo distinguish memo failures for tests + logging.
var (
	ErrNoMemo    = errors.New("entitle: no CVPN1 memo")
	ErrMultiMemo = errors.New("entitle: multiple CVPN1 memos")
	ErrBadCode   = errors.New("entitle: empty payment code")
)

// MemoParse extracts the single payment code from a tx's OP_RETURN payloads.
// Non-CVPN1 memos are ignored (docs/04-payments.md). Exactly one CVPN1 memo
// must be present.
func MemoParse(memos []string) (string, error) {
	var found string
	n := 0
	for _, m := range memos {
		if !strings.HasPrefix(m, memoPrefix) {
			continue
		}
		code := strings.TrimSpace(strings.TrimPrefix(m, memoPrefix))
		if code == "" {
			return "", ErrBadCode
		}
		found = code
		n++
	}
	switch n {
	case 0:
		return "", ErrNoMemo
	case 1:
		return found, nil
	default:
		return "", ErrMultiMemo
	}
	// POC: also validate `code` decodes as base58 of exactly 20 bytes to
	// reject malformed memos early (they can never match a real key anyway).
}

// --- base58 (Bitcoin alphabet), just enough to encode 20-byte hashes ---

const b58Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

func base58Encode(input []byte) string {
	// Count leading zero bytes -> leading '1's.
	zeros := 0
	for zeros < len(input) && input[zeros] == 0 {
		zeros++
	}
	// Base-256 -> base-58 via repeated division (big-endian byte math).
	buf := make([]byte, len(input))
	copy(buf, input)
	var out []byte
	for start := zeros; start < len(buf); {
		rem := 0
		for i := start; i < len(buf); i++ {
			acc := rem*256 + int(buf[i])
			buf[i] = byte(acc / 58)
			rem = acc % 58
		}
		out = append(out, b58Alphabet[rem])
		if buf[start] == 0 {
			start++
		}
	}
	// out is little-endian digits; reverse and prepend zeros.
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	prefix := make([]byte, zeros)
	for i := range prefix {
		prefix[i] = '1'
	}
	return string(append(prefix, out...))
}
