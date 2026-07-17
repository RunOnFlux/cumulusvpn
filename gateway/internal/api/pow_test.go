package api

import (
	"crypto/sha256"
	"strconv"
	"testing"
)

// TestHasLeadingZeroBits checks the bit-boundary logic byte- and bit-exactly,
// mirroring the contract in docs/10-api-contract.md (full = bits/8 zero bytes,
// then the next byte AND (0xff << (8-rem)) must be zero).
func TestHasLeadingZeroBits(t *testing.T) {
	cases := []struct {
		name   string
		digest []byte
		bits   int
		want   bool
	}{
		{"zero bits always true", []byte{0xff}, 0, true},
		{"one zero byte, 8 bits", []byte{0x00, 0xff}, 8, true},
		{"nonzero first byte, 8 bits", []byte{0x01, 0x00}, 8, false},
		{"4 leading zero bits ok", []byte{0x0f}, 4, true},
		{"3 leading zero bits, need 4", []byte{0x10}, 4, false},
		{"20 bits: two zero bytes + top nibble", []byte{0x00, 0x00, 0x0f}, 20, true},
		{"20 bits: third byte too big", []byte{0x00, 0x00, 0x10}, 20, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := hasLeadingZeroBits(tc.digest, tc.bits); got != tc.want {
				t.Errorf("hasLeadingZeroBits(%x, %d) = %v, want %v", tc.digest, tc.bits, got, tc.want)
			}
		})
	}
}

// TestSolvePoWRoundtrip solves the PoW for several pubkeys at a few
// difficulties and confirms the returned nonce is (a) a decimal string and
// (b) actually satisfies sha256(utf8(pubkey)||utf8(nonce)) with that many
// leading zero bits — the exact bytes every client language must hash.
func TestSolvePoWRoundtrip(t *testing.T) {
	pubkeys := []string{
		"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
		"AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
		"3Qz8m2Yp1kL0aB9cD7eF6gH5iJ4kK3lM2nN1oO0pP8=",
	}
	// Keep difficulties low so the test is fast but still exercises the
	// byte and sub-byte boundaries (8 = one byte, 12 = byte+nibble).
	for _, bits := range []int{8, 12} {
		for _, pk := range pubkeys {
			nonce := solvePoW(pk, bits)

			if _, err := strconv.ParseUint(nonce, 10, 64); err != nil {
				t.Fatalf("nonce %q is not a decimal string: %v", nonce, err)
			}

			h := sha256.New()
			h.Write([]byte(pk))
			h.Write([]byte(nonce))
			if !hasLeadingZeroBits(h.Sum(nil), bits) {
				t.Fatalf("solved nonce %q does not satisfy %d bits for %q", nonce, bits, pk)
			}
		}
	}
}

// TestCheckPoWReplay verifies the server accepts a valid solution once and
// rejects a replay, an empty nonce, and a wrong nonce.
func TestCheckPoWReplay(t *testing.T) {
	s := &Server{powSeen: make(map[string]struct{})}
	const pk = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="

	if s.checkPoW(pk, "") {
		t.Error("empty nonce should be rejected")
	}
	if s.checkPoW(pk, "1") {
		t.Error("a nonce that does not meet the difficulty should be rejected")
	}

	nonce := solvePoW(pk, powBits)
	if !s.checkPoW(pk, nonce) {
		t.Fatalf("valid nonce %q rejected", nonce)
	}
	if s.checkPoW(pk, nonce) {
		t.Error("replayed nonce should be rejected the second time")
	}
}
