// Package price is the FLUX price schedule: which monthly price a payment
// mined at a given block height is judged against (docs/04-payments.md
// "Price in FLUX vs $0.99").
//
// FLUX/USD moves, so the FLUX price has to move with it — but a payment is a
// fact about the past. Evaluating every historical tx against whatever the
// price is TODAY (the original single-constant rule) made each reprice
// retroactive: a drop from 20 to 12 turned every old 20-FLUX month into 50
// days, and a later rise would silently take days back from people who had
// already paid. A schedule fixes that by construction: each entry says "from
// this height on, the price is P", and a tx is only ever judged by the entries
// in force around its own height, so adding a future entry cannot change what
// any already-mined tx granted.
//
// Grace: for GraceBlocks after a change, a payment is judged against the
// LOWEST price in force at any point in that window. Someone who was quoted
// the old price just before a rise and paid just after it still gets their
// full month; after a drop the new, lower price applies immediately. Grace can
// only ever favour the payer.
//
// Wire format (env CVPN_PRICE_SCHEDULE, bridge PRICE_SCHEDULE — keep the three
// implementations in gateway/internal/price, bridge/src/price.ts and
// deploy/scripts/price.mjs byte-compatible):
//
//	20                     flat price, same as the legacy CVPN_PRICE_FLUX=20
//	20@0,12@2215000        20 FLUX until block 2214999, 12 FLUX from 2215000
//
// The first entry must start at height 0 (its "@0" may be omitted); every
// later entry needs an explicit height strictly above the previous one.
package price

import (
	"errors"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
)

// GraceBlocks is how long the previous price stays payable after a change:
// 72 h at the 30 s post-PON block time.
const GraceBlocks = 8640

// Only plain decimals: strconv would also take "1e3", ".5", "+5" or hex, and
// the bridge and deploy parsers must accept exactly the same strings. At most
// 8 decimals — a zat — because the bridge pays whole zats and a finer price
// would round a month's payout below it; at most 9 integer digits so every
// implementation prints the same canonical string (no exponent forms). Heights
// stop at 2^53-1, the largest the JavaScript implementations hold exactly.
var (
	fluxRe   = regexp.MustCompile(`^\d{1,9}(\.\d{1,8})?$`)
	heightRe = regexp.MustCompile(`^\d{1,16}$`)
)

const maxHeight = 1<<53 - 1

// maxEntries bounds the env value. One entry per reprice, and repricing more
// than monthly would itself be a problem worth noticing.
const maxEntries = 256

// Entry is one step of the schedule: from height From on, a 30-day month
// costs Flux.
type Entry struct {
	From int64
	Flux float64
}

// Schedule is an immutable, validated price schedule. The zero value is not
// usable; build one with Flat or Parse.
type Schedule struct {
	entries []Entry
}

// Flat is a schedule with a single price for all of history — exactly the
// legacy CVPN_PRICE_FLUX semantics.
func Flat(flux float64) Schedule {
	return Schedule{entries: []Entry{{From: 0, Flux: flux}}}
}

// Parse reads the wire format described in the package doc.
func Parse(s string) (Schedule, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return Schedule{}, errors.New("price: empty schedule")
	}
	parts := strings.Split(s, ",")
	if len(parts) > maxEntries {
		return Schedule{}, fmt.Errorf("price: %d entries, max %d", len(parts), maxEntries)
	}
	entries := make([]Entry, 0, len(parts))
	for i, raw := range parts {
		raw = strings.TrimSpace(raw)
		fluxStr, fromStr, hasFrom := strings.Cut(raw, "@")
		fluxStr, fromStr = strings.TrimSpace(fluxStr), strings.TrimSpace(fromStr)
		flux, err := strconv.ParseFloat(fluxStr, 64)
		if !fluxRe.MatchString(fluxStr) || err != nil || !(flux > 0) || math.IsInf(flux, 0) {
			return Schedule{}, fmt.Errorf("price: entry %d %q: price must be a positive number", i+1, raw)
		}
		var from int64
		if hasFrom {
			from, err = strconv.ParseInt(fromStr, 10, 64)
			if !heightRe.MatchString(fromStr) || err != nil || from < 0 || from > maxHeight {
				return Schedule{}, fmt.Errorf("price: entry %d %q: height must be a non-negative integer", i+1, raw)
			}
		} else if i > 0 {
			return Schedule{}, fmt.Errorf("price: entry %d %q: needs an @height", i+1, raw)
		}
		if i == 0 && from != 0 {
			return Schedule{}, fmt.Errorf("price: first entry %q must start at height 0", raw)
		}
		if i > 0 && from <= entries[i-1].From {
			return Schedule{}, fmt.Errorf("price: entry %d %q: heights must strictly increase", i+1, raw)
		}
		entries = append(entries, Entry{From: from, Flux: flux})
	}
	return Schedule{entries: entries}, nil
}

// String renders the canonical wire form ("20@0,12@2215000"), which is also
// what snapshots store and /v1/info reports.
func (s Schedule) String() string {
	var b strings.Builder
	for i, e := range s.entries {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(strconv.FormatFloat(e.Flux, 'f', -1, 64))
		b.WriteByte('@')
		b.WriteString(strconv.FormatInt(e.From, 10))
	}
	return b.String()
}

// Valid reports whether s was built by Flat or Parse.
func (s Schedule) Valid() bool { return len(s.entries) > 0 }

// Len is the number of entries.
func (s Schedule) Len() int { return len(s.entries) }

// Entry returns the i-th entry.
func (s Schedule) Entry(i int) Entry { return s.entries[i] }

// Latest is the price of the last entry — what CVPN_PRICE_FLUX should say.
func (s Schedule) Latest() float64 { return s.entries[len(s.entries)-1].Flux }

// index returns the entry in force at height h.
func (s Schedule) index(h int64) int {
	i := len(s.entries) - 1
	for i > 0 && s.entries[i].From > h {
		i--
	}
	return i
}

// At is the price in force at height h: what a new payment should be quoted.
func (s Schedule) At(h int64) float64 { return s.entries[s.index(h)].Flux }

// Effective is the price a tx mined at height h is judged against: the lowest
// price in force at any height in [h-GraceBlocks, h].
func (s Schedule) Effective(h int64) float64 {
	i := s.index(h)
	p := s.entries[i].Flux
	lo := h - GraceBlocks
	// Entry j was in force over [From_j, From_{j+1}); it overlaps the grace
	// window iff it was still in force at lo, i.e. From_{j+1} > lo.
	for j := i - 1; j >= 0 && s.entries[j+1].From > lo; j-- {
		p = math.Min(p, s.entries[j].Flux)
	}
	return p
}

// Equal reports whether two schedules are identical.
func (s Schedule) Equal(o Schedule) bool {
	if len(s.entries) != len(o.entries) {
		return false
	}
	for i := range s.entries {
		if s.entries[i] != o.entries[i] {
			return false
		}
	}
	return true
}

// HasPrefix reports whether s starts with every entry of prev — prev with zero
// or more entries appended, wherever they start.
func (s Schedule) HasPrefix(prev Schedule) bool { return s.Extends(prev, -1) }

// Extends reports whether s is prev with zero or more entries appended, all
// starting strictly after height `after`. That is exactly the condition under
// which every tx at or below `after` is judged identically by both schedules
// (grace included — an entry cannot influence Effective below its own start),
// so state derived under prev up to `after` stays valid under s.
func (s Schedule) Extends(prev Schedule, after int64) bool {
	if len(s.entries) < len(prev.entries) {
		return false
	}
	for i := range prev.entries {
		if s.entries[i] != prev.entries[i] {
			return false
		}
	}
	if len(s.entries) > len(prev.entries) && s.entries[len(prev.entries)].From <= after {
		return false
	}
	return true
}
