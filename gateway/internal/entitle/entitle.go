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
//   - a tx grants entitlement iff it pays >= price/30 (one day's worth)
//     to the payment address with exactly one valid CVPN1 memo and >= 1
//     confirmation
//   - price is the schedule's effective price at the tx's OWN block height
//     (internal/price), so a reprice never re-judges an already-mined tx
//   - effect: paid_until[code] = max(now, paid_until[code]) + days, where
//     days = floor(30 * amount / price) — pro-rata by the day, so whole
//     multiples of the price grant whole 30-day months exactly as before,
//     and fractional amounts (voucher settlements, docs/18) grant days.
//     Stacking, capped at +24 months of prepaid time.
package entitle

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/runonflux/cumulusvpn-gateway/internal/price"
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
	// overlapBlocks is how far below the cursor every scan re-reads (20 min).
	// The chain height comes from the host daemon but the history usually from
	// the public explorer, which can lag it: a payment in a block the explorer
	// had not indexed yet would otherwise fall behind the cursor for good. The
	// overlap re-reads it on a later poll, and `seen` keeps anything already
	// folded from being applied twice — which also absorbs a shallow reorg
	// re-mining a tx at a new height, and page shifts while a scan pages.
	overlapBlocks = 40
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
	src     TxSource
	address string

	mu        sync.RWMutex
	sched     price.Schedule       // the schedule paidUntil was derived under
	paidUntil map[string]time.Time // code -> paid_until
	lastBlock int64
	// tip is the latest chain height BlockCount reported — what Quote prices
	// the next block at, tracked apart from the cursor so a failing history
	// source cannot leave quotes stuck on an old schedule entry.
	tip int64
	// seen holds every folded txid with height > lastBlock-overlapBlocks, so
	// the overlapping re-read never grants a tx twice (stack is additive).
	seen map[string]int64
	// seenFrom: seen is only complete above this height, and no scan reads
	// below it. Non-zero after loading a snapshot written before `seen`
	// existed — its cursor is then the floor, exactly the old behaviour.
	seenFrom int64

	// pending is a schedule handed over by Reprice, applied by the Run loop
	// before its next poll so the scan state has a single writer.
	pending atomic.Pointer[price.Schedule]

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

// New builds an Engine. address and sched come from config.
func New(src TxSource, address string, sched price.Schedule) *Engine {
	return &Engine{
		src:       src,
		address:   address,
		sched:     sched,
		paidUntil: make(map[string]time.Time),
		seen:      make(map[string]int64),
	}
}

// Schedule is the price schedule the engine currently judges payments by.
func (e *Engine) Schedule() price.Schedule {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.sched
}

// Quote is the price a new payment should be quoted at: the entry in force at
// the next block. Until any chain height is known it quotes the higher of the
// last two entries: overpaying only ever buys extra days, while quoting a
// scheduled DROP early would sell a month for a fraction of one.
func (e *Engine) Quote() float64 {
	e.mu.RLock()
	defer e.mu.RUnlock()
	if e.tip > 0 {
		return e.sched.At(e.tip + 1)
	}
	q := e.sched.Latest()
	if n := e.sched.Len(); n > 1 && e.sched.Entry(n-2).Flux > q {
		q = e.sched.Entry(n - 2).Flux
	}
	return q
}

// Reprice hands the engine a new price schedule (a hot-reloaded app spec).
// Run applies it before its next poll. Only APPENDED entries are hot-applied:
// one starting above the scan cursor is swapped in as-is; one that reached
// this node after its start height rebuilds the map from height 0, guarded
// against a truncated history. A schedule that edits existing entries is
// refused here — it re-judges history, so it waits for a deliberate
// redeploy rather than rippling across the fleet in five minutes.
func (e *Engine) Reprice(s price.Schedule) {
	if s.Valid() {
		e.pending.Store(&s)
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
// none), less the overlap window.
func (e *Engine) Backfill(ctx context.Context) error {
	if _, err := e.scan(ctx, true); err != nil {
		return err
	}
	if err := e.Save(); err != nil {
		// Losing the snapshot costs a rescan next boot, nothing more.
		log.Printf("entitle: snapshot save: %v", err)
	}
	return nil
}

// scan folds every payment up to the current chain height and advances the
// cursor to it. The height is read FIRST and nothing above it is applied, so
// a tx mined while the history is fetched waits for the next scan; the read
// starts overlapBlocks below the cursor so a tx the explorer indexed late is
// still found, and `seen` makes that re-read idempotent. `force` scans even
// when no new block has arrived (the boot backfill).
func (e *Engine) scan(ctx context.Context, force bool) (int, error) {
	height, err := e.src.BlockCount(ctx)
	if err != nil {
		return 0, err
	}
	if height <= 0 {
		return 0, fmt.Errorf("entitle: implausible chain height %d", height)
	}
	e.mu.Lock()
	if height > e.tip {
		e.tip = height
	}
	last := e.lastBlock
	from := e.scanFromLocked()
	e.mu.Unlock()
	// A lagging height source must never pull the cursor backwards; and with
	// no new block there is nothing new to read.
	if height < last || (height == last && !force) {
		return 0, nil
	}
	txs, err := e.src.AddressTxs(ctx, e.address, from)
	if err != nil {
		return 0, err
	}
	granted := e.applyTxs(txs, height)
	e.mu.Lock()
	e.lastBlock = height
	for id, h := range e.seen {
		if h <= height-overlapBlocks {
			delete(e.seen, id)
		}
	}
	e.dirty = true
	e.mu.Unlock()
	return granted, nil
}

// scanFromLocked is the height a scan reads history above. Callers hold mu.
func (e *Engine) scanFromLocked() int64 {
	from := e.lastBlock - overlapBlocks
	if from < e.seenFrom {
		from = e.seenFrom
	}
	if from < 0 {
		from = 0
	}
	return from
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
			e.applyPending(ctx)
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
	granted, err := e.scan(ctx, false)
	if err != nil {
		log.Printf("entitle: scan: %v", err)
		return
	}
	// Real entitlement changed — checkpoint now rather than waiting out the
	// throttle, so a crash in the next minute cannot lose a paid grant's
	// cursor and serve that user free until the rescan catches up.
	if granted > 0 {
		if err := e.Save(); err != nil {
			log.Printf("entitle: snapshot save: %v", err)
		}
	}
}

// applyTxs folds a batch of (oldest-first) txs into the paid_until map,
// skipping any tx already folded (seen) and any tx that is unconfirmed or
// above `upTo` — the height the caller's cursor will move to — so those are
// read again, and applied once, by a later scan. Returns the number of grants
// applied, so callers can checkpoint the snapshot promptly.
func (e *Engine) applyTxs(txs []Tx, upTo int64) int {
	granted := 0
	for _, tx := range txs {
		if tx.Height <= 0 || tx.Height > upTo {
			continue
		}
		e.mu.Lock()
		if _, dup := e.seen[tx.TxID]; dup && tx.TxID != "" {
			e.mu.Unlock()
			continue
		}
		if tx.TxID != "" {
			e.seen[tx.TxID] = tx.Height
		}
		code, prev, ok := grant(e.paidUntil, tx, e.address, e.sched)
		now := time.Now()
		wasPremium := prev.After(now)
		nowPremium := ok && e.paidUntil[code].After(now)
		if ok {
			e.dirty = true
		}
		e.mu.Unlock()
		if !ok {
			continue
		}
		granted++
		if !wasPremium && nowPremium && e.onChange != nil {
			e.onChange(code, true)
		}
	}
	return granted
}

// grant applies one tx to m under sched, returning the code it credited and
// that code's paid_until before the grant.
//
// Pro-rata by the day: days = floor(30 * amount / price). Whole multiples of
// the price grant whole 30-day months exactly as the original months rule did
// ("pay 3x -> 90 days"); fractional amounts (bridge voucher settlements,
// docs/18 — sized ceil(price*days/30) in zats so this floor never truncates)
// grant days. AmountTo is a float64 sum of vout values, so an exact multiple
// can land a hair below the integer — the same epsilon ValidPayment uses keeps
// 59.999… at 90 days, not 89.
//
// The price is the schedule's EFFECTIVE price at the tx's own height, never
// today's: that is what makes a reprice prospective (internal/price).
func grant(m map[string]time.Time, tx Tx, address string, sched price.Schedule) (string, time.Time, bool) {
	p := sched.Effective(tx.Height)
	code, ok := ValidPayment(tx, address, p)
	if !ok {
		return "", time.Time{}, false
	}
	days := int(30 * (tx.AmountTo + 1e-9) / p)
	if days < 1 {
		return "", time.Time{}, false // ValidPayment already rejects; belt and braces
	}
	prev := m[code]
	m[code] = stack(prev, days, tx.Time)
	return code, prev, true
}

// applyPending installs a schedule handed over by Reprice. Called only from
// Run, which owns the scan state, so it never races a poll.
func (e *Engine) applyPending(ctx context.Context) {
	p := e.pending.Swap(nil)
	if p == nil {
		return
	}
	next := *p
	e.mu.RLock()
	cur, last := e.sched, e.lastBlock
	e.mu.RUnlock()
	if next.Equal(cur) {
		return
	}
	if !next.HasPrefix(cur) {
		log.Printf("entitle: NOT hot-applying price schedule %s: it edits the running %s "+
			"(re-judges past payments); it applies at the next redeploy", next, cur)
		return
	}

	// The normal reprice: entries appended above everything already folded,
	// so no past grant changes. Swap and go.
	if next.Extends(cur, last) {
		e.mu.Lock()
		e.sched = next
		e.dirty = true
		e.mu.Unlock()
		log.Printf("entitle: price schedule %s -> %s (prospective, no rescan)", cur, next)
		if err := e.Save(); err != nil {
			log.Printf("entitle: snapshot save: %v", err)
		}
		return
	}

	// The spec reached this node after the new entry's start height, so txs
	// already folded at the old price fall under it. paid_until cannot be
	// un-folded: derive it again from height 0 into a fresh map, keep serving
	// the old one meanwhile, and swap only if the rebuild is trustworthy.
	fresh, freshSeen, height, n, err := e.rebuild(ctx, next)
	if err != nil {
		// Try again next tick unless a newer schedule has arrived meanwhile.
		e.pending.CompareAndSwap(nil, p)
		log.Printf("entitle: rescan for price schedule %s: %v; retrying", next, err)
		return
	}
	now := time.Now()
	e.mu.Lock()
	old := e.paidUntil
	e.sched = next
	e.paidUntil = fresh
	e.seen = freshSeen
	e.seenFrom = 0
	e.lastBlock = height
	e.dirty = true
	e.mu.Unlock()
	log.Printf("entitle: price schedule %s -> %s (rebuilt from %d txs)", cur, next, n)
	if e.onChange != nil {
		for code, pu := range fresh {
			if pu.After(now) && !old[code].After(now) {
				e.onChange(code, true)
			}
		}
	}
	if err := e.Save(); err != nil {
		log.Printf("entitle: snapshot save: %v", err)
	}
}

// rebuild derives paid_until from the whole history under sched, refusing any
// result that is visibly incomplete — a truncated or lagging history source
// would otherwise swap in (and persist) a map missing paid users.
func (e *Engine) rebuild(ctx context.Context, sched price.Schedule) (map[string]time.Time, map[string]int64, int64, int, error) {
	height, err := e.src.BlockCount(ctx)
	if err != nil {
		return nil, nil, 0, 0, err
	}
	e.mu.RLock()
	last := e.lastBlock
	had := len(e.paidUntil)
	known := make([]string, 0, len(e.seen))
	for id := range e.seen {
		known = append(known, id)
	}
	e.mu.RUnlock()
	if height <= 0 || height < last {
		return nil, nil, 0, 0, fmt.Errorf("chain height %d is behind the cursor %d", height, last)
	}
	txs, err := e.src.AddressTxs(ctx, e.address, 0)
	if err != nil {
		return nil, nil, 0, 0, err
	}
	fresh := make(map[string]time.Time)
	freshSeen := make(map[string]int64)
	all := make(map[string]bool, len(txs))
	n := 0
	for _, tx := range txs {
		if tx.Height <= 0 || tx.Height > height || (tx.TxID != "" && all[tx.TxID]) {
			continue
		}
		all[tx.TxID] = true
		if tx.Height > height-overlapBlocks && tx.TxID != "" {
			freshSeen[tx.TxID] = tx.Height
		}
		grant(fresh, tx, e.address, sched)
		n++
	}
	for _, id := range known {
		if !all[id] {
			return nil, nil, 0, 0, fmt.Errorf("history is missing already-folded tx %s", id)
		}
	}
	if had > 0 && n == 0 {
		return nil, nil, 0, 0, fmt.Errorf("history came back empty")
	}
	return fresh, freshSeen, height, n, nil
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
// priceFlux (the effective price at the tx's height), returning the payment
// code from its memo. A valid tx must:
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
