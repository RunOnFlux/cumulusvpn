package entitle

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/runonflux/cumulusvpn-gateway/internal/price"
)

// snapshotVersion guards the on-disk format. Bump it whenever the meaning of
// a field changes; an unrecognised version is discarded rather than guessed
// at, which costs one full backfill and never a wrong entitlement.
const snapshotVersion = 1

// snapshot is the persisted form of the derived entitlement state.
//
// It is a **cache of a deterministic chain derivation**, never a source of
// truth: every field can be rebuilt by replaying the payment address from
// height 0. That is what makes it safe to discard on the slightest doubt —
// unlike the peer cache (wg.LoadPeerCache), losing this file costs startup
// time, not data, so there is no read-only mode to protect here.
//
// Address and the price schedule are stored so a snapshot cannot outlive the
// parameters it was derived under. Repointing the fleet at a new payment
// address, or editing the price history, changes what historical txs granted;
// replaying from a stale cursor would silently keep the old answers. A
// schedule that merely APPENDS entries above the cursor is the one exception
// — it re-judges nothing already folded (price.Schedule.Extends) — which is
// what lets a normal reprice keep the snapshot instead of rescanning.
//
// PriceFlux is the flat price for a single-entry schedule — the only shape a
// pre-schedule image understands, so a rollback on a flat fleet keeps its
// snapshot. It is 0 for a multi-entry schedule on purpose: an older image
// compares it to CVPN_PRICE_FLUX, rejects the file and rescans like every
// other old-image node, instead of resuming from history derived under rules
// it does not implement. Snapshots from before schedules carry only this
// field and are read as a flat schedule.
//
// Seen/SeenFrom persist the overlap-dedup state (entitle.go overlapBlocks):
// txids already folded near the cursor, complete above SeenFrom. A snapshot
// without them predates the overlap; its cursor becomes the scan floor.
type snapshot struct {
	Version       int              `json:"version"`
	Address       string           `json:"address"`
	PriceFlux     float64          `json:"price_flux"`
	PriceSchedule string           `json:"price_schedule,omitempty"`
	LastBlock     int64            `json:"last_block"`
	PaidUntil     map[string]int64 `json:"paid_until"` // code -> unix seconds
	Seen          map[string]int64 `json:"seen_txids"` // txid -> height; nil = pre-overlap file
	SeenFrom      int64            `json:"seen_from"`
}

// SetStatePath enables snapshot persistence at path. Call before Load/Backfill;
// an empty path leaves the engine purely in-memory (the previous behaviour).
func (e *Engine) SetStatePath(path string) {
	e.statePath = path
}

// Load restores a previously saved snapshot so a restart resumes from the
// stored cursor instead of rescanning the whole payment history (~2,000
// sequential explorer requests at 100k txs, during which the node serves
// free-only).
//
// Any problem — missing file, unreadable, wrong version, different payment
// address or price history — is reported as "not loaded" and leaves the engine empty,
// so the caller's Backfill starts from 0 exactly as it always did. Callers
// should log the reason but must not treat it as fatal.
func (e *Engine) Load() (bool, error) {
	if e.statePath == "" {
		return false, nil
	}
	raw, err := os.ReadFile(e.statePath)
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, fmt.Errorf("entitle: read snapshot: %w", err)
	}
	var s snapshot
	if err := json.Unmarshal(raw, &s); err != nil {
		return false, fmt.Errorf("entitle: parse snapshot: %w", err)
	}
	if s.Version != snapshotVersion {
		return false, fmt.Errorf("entitle: snapshot version %d, want %d", s.Version, snapshotVersion)
	}
	if s.Address != e.address {
		return false, fmt.Errorf("entitle: snapshot is for address %q, configured %q", s.Address, e.address)
	}
	if s.LastBlock < 0 {
		return false, fmt.Errorf("entitle: snapshot has negative last_block %d", s.LastBlock)
	}
	stored := price.Flat(s.PriceFlux)
	if s.PriceSchedule != "" {
		if stored, err = price.Parse(s.PriceSchedule); err != nil {
			return false, fmt.Errorf("entitle: snapshot schedule: %w", err)
		}
	} else if !(s.PriceFlux > 0) {
		return false, fmt.Errorf("entitle: snapshot has no price")
	}
	if !e.sched.Extends(stored, s.LastBlock) {
		return false, fmt.Errorf("entitle: snapshot priced under %s, configured %s (cursor %d)",
			stored, e.sched, s.LastBlock)
	}

	loaded := make(map[string]time.Time, len(s.PaidUntil))
	for code, unix := range s.PaidUntil {
		loaded[code] = time.Unix(unix, 0).UTC()
	}
	seen, seenFrom := s.Seen, s.SeenFrom
	if seen == nil {
		seen, seenFrom = make(map[string]int64), s.LastBlock
	}
	e.mu.Lock()
	e.paidUntil = loaded
	e.lastBlock = s.LastBlock
	e.seen = seen
	e.seenFrom = seenFrom
	e.mu.Unlock()
	return true, nil
}

// Save atomically writes the current state. A no-op without a state path.
//
// Expired codes are dropped: `stack` treats a paid_until in the past exactly
// like an absent entry, so keeping them would only grow the file for the
// lifetime of the deployment. A code that pays again simply reappears.
func (e *Engine) Save() error {
	if e.statePath == "" {
		return nil
	}
	now := time.Now()
	e.mu.RLock()
	s := snapshot{
		Version:       snapshotVersion,
		Address:       e.address,
		PriceSchedule: e.sched.String(),
		LastBlock:     e.lastBlock,
		PaidUntil:     make(map[string]int64, len(e.paidUntil)),
		Seen:          make(map[string]int64, len(e.seen)),
		SeenFrom:      e.seenFrom,
	}
	if e.sched.Len() == 1 {
		s.PriceFlux = e.sched.Latest()
	}
	for id, h := range e.seen {
		s.Seen[id] = h
	}
	for code, pu := range e.paidUntil {
		if pu.After(now) {
			s.PaidUntil[code] = pu.Unix()
		}
	}
	e.mu.RUnlock()

	raw, err := json.Marshal(&s)
	if err != nil {
		return fmt.Errorf("entitle: encode snapshot: %w", err)
	}
	// Temp + rename in the same directory: a crash mid-write must leave the
	// previous good snapshot intact rather than a truncated file that the
	// next boot would reject (costing the full rescan we are avoiding).
	dir := filepath.Dir(e.statePath)
	tmp, err := os.CreateTemp(dir, ".entitle-*.tmp")
	if err != nil {
		return fmt.Errorf("entitle: temp snapshot: %w", err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName) // no-op once the rename succeeds
	if _, err := tmp.Write(raw); err != nil {
		tmp.Close()
		return fmt.Errorf("entitle: write snapshot: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return fmt.Errorf("entitle: sync snapshot: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("entitle: close snapshot: %w", err)
	}
	if err := os.Rename(tmpName, e.statePath); err != nil {
		return fmt.Errorf("entitle: rename snapshot: %w", err)
	}
	e.mu.Lock()
	e.dirty = false
	e.lastSaved = now
	e.mu.Unlock()
	return nil
}
