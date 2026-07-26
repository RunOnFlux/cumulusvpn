package wg

import (
	"bufio"
	"fmt"
	"log"
	"net/netip"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

// The peer table used to live only in memory, which quietly made every issued
// config disposable: a container restart — same node, same IP, same server key —
// dropped every enrollment, so the next handshake from a known client failed.
// The full apps paper over that by re-enrolling on connect, but the web client
// hands the user a static WireGuard .conf consumed by the stock app, which can
// never re-enroll. For those users a restart was permanent breakage with no
// in-product recovery, and WireGuard's failure mode is silent (the tunnel reads
// "connected", the handshake just never completes).
//
// So the assignment survives a restart: pubkey -> assigned 10.8.x.y, plus a
// last-seen stamp, written next to the server key. Tier is deliberately NOT
// persisted — entitlement is re-derived from chain by the entitlement engine,
// which backfills from block 0 before the API serves, so a cached tier could
// only ever be a stale duplicate of the truth.
//
// This is a cache, not a database, and it is treated as REPLACEABLE but never
// DESTROYABLE: every failure mode degrades to the old behaviour (peers
// re-enroll) rather than taking the gateway down, and a load that could not be
// fully understood leaves the file untouched instead of overwriting it — see
// LoadPeerCache's `clean` return.

const (
	// peerCacheV2 adds the last-seen stamp that idle eviction needs.
	peerCacheV2 = "cvpn-peers-v2"
	// peerCacheV1 had no stamp. Still read, so an upgrade keeps everyone's
	// enrollment; missing stamps are treated as "seen now" so the first boot
	// after the upgrade evicts nobody.
	peerCacheV1 = "cvpn-peers-v1"
)

// PeerRecord is one persisted enrollment: a client pubkey, the tunnel address it
// was assigned, and when it last completed a handshake.
type PeerRecord struct {
	PubKey string
	Addr   netip.Addr
	Seen   time.Time
}

// LoadPeerCache reads persisted enrollments from path.
//
// It never fails hard: a missing, unreadable or corrupt file yields no records,
// which is exactly the pre-persistence behaviour. The second return value
// reports whether the file was read COMPLETELY and understood. When it is false
// the caller must not enable write-back, or the next write would replace a file
// it could not read with one derived from the little it recovered — turning a
// transient permission error, an operator lowering the peer ceiling, or a
// rollback to an older image into permanent, silent data loss.
//
// max bounds how many records are returned so a file that grew unexpectedly
// can't push the peer table past the gateway's own capacity guards; hitting that
// ceiling is itself a not-clean condition, since the excess must not be dropped
// from disk.
func LoadPeerCache(path string, max int) (recs []PeerRecord, clean bool) {
	sweepTempFiles(path)

	f, err := os.Open(path) // #nosec G304 — operator-configured state path
	if err != nil {
		if os.IsNotExist(err) {
			return nil, true // first boot: nothing to read, safe to write
		}
		log.Printf("wg: peer cache %s unreadable (%v); NOT persisting this run so the file is preserved", path, err)
		return nil, false
	}
	defer f.Close()

	sc := bufio.NewScanner(f)
	if !sc.Scan() {
		// Empty file: nothing to lose by rewriting it.
		return nil, true
	}
	version := strings.TrimSpace(sc.Text())
	if version != peerCacheV2 && version != peerCacheV1 {
		log.Printf("wg: peer cache %s has format %q, which this build does not understand; "+
			"NOT persisting this run so a newer/older build can still read it", path, version)
		return nil, false
	}

	now := time.Now()
	var (
		seen    = make(map[string]struct{})
		skipped int
	)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			skipped++
			continue
		}
		pk, addrStr := fields[0], fields[1]
		// Validate the key the same way enroll does, so a corrupt cache can never
		// inject something the device would reject (or worse, accept).
		if _, err := decodeKey(pk); err != nil {
			skipped++
			continue
		}
		addr, err := netip.ParseAddr(addrStr)
		if err != nil || !addr.Is4() {
			skipped++
			continue
		}
		if _, dup := seen[pk]; dup {
			skipped++
			continue
		}
		// v1 rows have no stamp; treat them as fresh so upgrading evicts nobody.
		stamp := now
		if len(fields) >= 3 {
			if secs, err := strconv.ParseInt(fields[2], 10, 64); err == nil && secs > 0 {
				stamp = time.Unix(secs, 0)
			}
		}
		seen[pk] = struct{}{}
		recs = append(recs, PeerRecord{PubKey: pk, Addr: addr, Seen: stamp})
		if max > 0 && len(recs) >= max {
			log.Printf("wg: peer cache %s holds more than the %d-peer ceiling; registering the first %d and "+
				"NOT persisting this run so the rest stay on disk", path, max, max)
			return recs, false
		}
	}
	if err := sc.Err(); err != nil {
		log.Printf("wg: peer cache %s read error (%v); NOT persisting this run so the file is preserved", path, err)
		return recs, false
	}
	if skipped > 0 {
		// Malformed rows are dropped on the next write, which is the point of a
		// cache — but say so, since it means someone or something corrupted it.
		log.Printf("wg: peer cache %s: skipped %d malformed record(s)", path, skipped)
	}
	return recs, true
}

// sweepTempFiles removes leftovers from a save that died between CreateTemp and
// rename. Without this they accumulate in /data forever, one per crash.
func sweepTempFiles(path string) {
	dir := filepath.Dir(path)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		n := e.Name()
		if !e.IsDir() && strings.HasPrefix(n, ".peers-") && strings.HasSuffix(n, ".tmp") {
			_ = os.Remove(filepath.Join(dir, n))
		}
	}
}

// savePeerCache writes records to path atomically (temp file + fsync + rename),
// so a crash or a full disk mid-write leaves the previous good cache in place
// rather than a truncated one.
func savePeerCache(path string, recs []PeerRecord) error {
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, ".peers-*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer func() {
		// Best-effort cleanup on any failure path; after a successful rename this
		// misses, which is fine.
		_ = os.Remove(tmpName)
	}()

	// Deterministic order keeps the file diffable and makes tests stable.
	sorted := make([]PeerRecord, len(recs))
	copy(sorted, recs)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].PubKey < sorted[j].PubKey })

	w := bufio.NewWriter(tmp)
	if _, err := fmt.Fprintln(w, peerCacheV2); err != nil {
		_ = tmp.Close()
		return err
	}
	for _, r := range sorted {
		seen := r.Seen.Unix()
		if r.Seen.IsZero() {
			seen = 0
		}
		if _, err := fmt.Fprintf(w, "%s %s %d\n", r.PubKey, r.Addr, seen); err != nil {
			_ = tmp.Close()
			return err
		}
	}
	if err := w.Flush(); err != nil {
		_ = tmp.Close()
		return err
	}
	// fsync before rename: a rename is only durable if the data behind it is.
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmpName, 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmpName, path); err != nil {
		return err
	}
	// Sync the DIRECTORY too, or the rename itself can be lost in a crash even
	// though the file contents were durable.
	if d, err := os.Open(dir); err == nil {
		_ = d.Sync()
		_ = d.Close()
	}
	return nil
}
