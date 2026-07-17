package fluxnode

import (
	"encoding/hex"
	"encoding/json"
	"reflect"
	"testing"
)

// opReturn builds a canonical OP_RETURN script hex for the given payload,
// choosing the direct-push (6a <len> data) or PUSHDATA1 (6a 4c <len> data)
// form based on length, so test inputs mirror real scriptPubKeys.
func opReturn(payload []byte) string {
	b := []byte{0x6a}
	if len(payload) <= 0x4b {
		b = append(b, byte(len(payload)))
	} else {
		b = append(b, 0x4c, byte(len(payload)))
	}
	b = append(b, payload...)
	return hex.EncodeToString(b)
}

func longString(n int) string {
	b := make([]byte, n)
	for i := range b {
		b[i] = 'a'
	}
	return string(b)
}

func TestDecodeOpReturn(t *testing.T) {
	cases := []struct {
		name   string
		hexScr string
		want   string
		wantOK bool
	}{
		{"direct push short memo", opReturn([]byte("CVPN1:abc")), "CVPN1:abc", true},
		{"direct push single byte", opReturn([]byte("x")), "x", true},
		{"pushdata1 long memo", opReturn([]byte("CVPN1:" + longString(90))), "CVPN1:" + longString(90), true},
		{"not op_return (p2pkh prefix)", "76a914aabbccdd88ac", "", false},
		{"empty script", "", "", false},
		{"one byte script", "6a", "", false},
		{"truncated direct push (len says 5, have 4)", "6a0568656c6c", "", false},
		{"truncated pushdata1", "6a4c05deadbeef", "", false},
		{"bad hex", "zzzz", "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := decodeOpReturn(tc.hexScr)
			if ok != tc.wantOK || got != tc.want {
				t.Errorf("decodeOpReturn(%q) = (%q, %v), want (%q, %v)", tc.hexScr, got, ok, tc.want, tc.wantOK)
			}
		})
	}
}

// txFromJSON unmarshals a raw insight-style transaction into insightTx so tests
// exercise the same struct+tags the wire path decodes into.
func txFromJSON(t *testing.T, raw string) insightTx {
	t.Helper()
	var tx insightTx
	if err := json.Unmarshal([]byte(raw), &tx); err != nil {
		t.Fatalf("unmarshal insightTx: %v", err)
	}
	return tx
}

func TestNormalizeTx(t *testing.T) {
	const addr = "t1payMe"
	memoHex := opReturn([]byte("CVPN1:token123"))
	// vout 0: OP_RETURN memo. vout 1: 2.5 to our addr. vout 2: 1.0 to our addr
	// (must sum). vout 3: 9.9 to a different address (must be ignored).
	raw := `{
	  "txid": "deadbeef",
	  "blockheight": 12345,
	  "time": 1600000000,
	  "vout": [
	    {"value": "0", "scriptPubKey": {"hex": "` + memoHex + `", "addresses": []}},
	    {"value": "2.5", "scriptPubKey": {"hex": "76a914aa88ac", "addresses": ["` + addr + `"]}},
	    {"value": "1.0", "scriptPubKey": {"hex": "76a914bb88ac", "addresses": ["` + addr + `"]}},
	    {"value": "9.9", "scriptPubKey": {"hex": "76a914cc88ac", "addresses": ["t1someoneElse"]}}
	  ]
	}`
	got := normalizeTx(txFromJSON(t, raw), addr)

	if got.TxID != "deadbeef" || got.Height != 12345 {
		t.Errorf("TxID/Height = %q/%d", got.TxID, got.Height)
	}
	if got.Time.Unix() != 1_600_000_000 {
		t.Errorf("Time.Unix() = %d, want 1600000000", got.Time.Unix())
	}
	if want := []string{"CVPN1:token123"}; !reflect.DeepEqual(got.Memos, want) {
		t.Errorf("Memos = %v, want %v", got.Memos, want)
	}
	if got.AmountTo != 3.5 {
		t.Errorf("AmountTo = %v, want 3.5 (2.5 + 1.0 to our addr only)", got.AmountTo)
	}
}

func TestNormalizeTxNoAddrFilterOnlyMemos(t *testing.T) {
	// With addr == "" (the RawTransaction path) memos are still decoded but no
	// amount is attributed to any address.
	memoHex := opReturn([]byte("CVPN1:abc"))
	raw := `{
	  "txid": "tx2",
	  "blockheight": 1,
	  "time": 1,
	  "vout": [
	    {"value": "0", "scriptPubKey": {"hex": "` + memoHex + `", "addresses": []}},
	    {"value": "5.0", "scriptPubKey": {"hex": "76a914dd88ac", "addresses": ["t1whoever"]}}
	  ]
	}`
	got := normalizeTx(txFromJSON(t, raw), "")
	if want := []string{"CVPN1:abc"}; !reflect.DeepEqual(got.Memos, want) {
		t.Errorf("Memos = %v, want %v", got.Memos, want)
	}
	if got.AmountTo != 0 {
		t.Errorf("AmountTo = %v, want 0 when addr filter empty", got.AmountTo)
	}
}
