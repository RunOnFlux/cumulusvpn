package entitle

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
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
// Address and PriceFlux are stored so a snapshot cannot outlive the
// parameters it was derived under. Repointing the fleet at a new payment
// address, or repricing, changes what every historical tx granted; replaying
// from a stale cursor would silently keep the old answers.
type snapshot struct {
	Version   int              `json:"version"`
	Address   string           `json:"address"`
	PriceFlux float64          `json:"price_flux"`
	LastBlock int64            `json:"last_block"`
	PaidUntil map[string]int64 `json:"paid_until"` // code -> unix seconds
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
// address or price — is reported as "not loaded" and leaves the engine empty,
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
	if s.PriceFlux != e.priceFlux {
		return false, fmt.Errorf("entitle: snapshot priced at %g, configured %g", s.PriceFlux, e.priceFlux)
	}
	if s.LastBlock < 0 {
		return false, fmt.Errorf("entitle: snapshot has negative last_block %d", s.LastBlock)
	}

	loaded := make(map[string]time.Time, len(s.PaidUntil))
	for code, unix := range s.PaidUntil {
		loaded[code] = time.Unix(unix, 0).UTC()
	}
	e.mu.Lock()
	e.paidUntil = loaded
	e.lastBlock = s.LastBlock
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
		Version:   snapshotVersion,
		Address:   e.address,
		PriceFlux: e.priceFlux,
		LastBlock: e.lastBlock,
		PaidUntil: make(map[string]int64, len(e.paidUntil)),
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
