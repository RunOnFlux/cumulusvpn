package api

import (
	"crypto/sha256"
	"strconv"
)

// powBits is the hashcash difficulty: number of leading zero bits required in
// sha256(pubkey || nonce). ~20 bits is ~1s of client work on a phone, cheap
// to verify, enough to make peer-table flooding expensive (docs/03-gateway.md
// "Anti-abuse on enroll").
const powBits = 20

// checkPoW verifies a hashcash-style solution and guards against nonce replay.
// The client searches for a nonce such that sha256(pubkey||nonce) has powBits
// leading zero bits. Each accepted nonce is single-use.
func (s *Server) checkPoW(pubkey, nonce string) bool {
	if nonce == "" {
		return false
	}
	h := sha256.New()
	h.Write([]byte(pubkey))
	h.Write([]byte(nonce))
	if !hasLeadingZeroBits(h.Sum(nil), powBits) {
		return false
	}
	// Replay guard: a valid nonce may be spent only once.
	// POC: this map grows unbounded; bind nonces to a rotating server epoch
	// (e.g. include a time-bucketed challenge in the hash) and GC old ones.
	key := pubkey + "|" + nonce
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, seen := s.powSeen[key]; seen {
		return false
	}
	s.powSeen[key] = struct{}{}
	return true
}

// hasLeadingZeroBits reports whether digest starts with at least n zero bits.
func hasLeadingZeroBits(digest []byte, n int) bool {
	full := n / 8
	for i := 0; i < full; i++ {
		if digest[i] != 0 {
			return false
		}
	}
	if rem := n % 8; rem != 0 {
		mask := byte(0xff << (8 - rem))
		if digest[full]&mask != 0 {
			return false
		}
	}
	return true
}

// solvePoW is a reference solver (used by clients / tests) that finds a nonce
// meeting the difficulty. The nonce is the DECIMAL STRING of a counter so it
// round-trips through JSON unchanged and every client language (TS/Swift/Kotlin)
// hashes the exact same bytes: sha256(utf8(pubkeyB64) || utf8(nonceDecimal)).
// Included so the enroll flow is testable end to end.
func solvePoW(pubkey string, bits int) string {
	for i := uint64(0); ; i++ {
		nonce := strconv.FormatUint(i, 10)
		h := sha256.New()
		h.Write([]byte(pubkey))
		h.Write([]byte(nonce))
		if hasLeadingZeroBits(h.Sum(nil), bits) {
			return nonce
		}
	}
}
