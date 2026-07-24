package tlsrelay

import (
	"bytes"
	"crypto/tls"
	"testing"
)

// TestFrameRoundTrip checks the length-prefixed framing that carries WG
// datagrams over the TLS stream: several datagrams written back-to-back must
// read back byte-identical and in order (including a max-ish sized one).
func TestFrameRoundTrip(t *testing.T) {
	var buf bytes.Buffer
	inputs := [][]byte{
		{0x01},
		bytes.Repeat([]byte{0xAB}, 1500), // ~ a full WG data packet
		{0xde, 0xad, 0xbe, 0xef},
	}
	for _, in := range inputs {
		if err := writeFrame(&buf, in); err != nil {
			t.Fatalf("writeFrame: %v", err)
		}
	}
	for i, want := range inputs {
		got, err := readFrame(&buf)
		if err != nil {
			t.Fatalf("readFrame[%d]: %v", i, err)
		}
		if !bytes.Equal(got, want) {
			t.Fatalf("frame[%d] mismatch: got %d bytes, want %d", i, len(got), len(want))
		}
	}
}

// TestSelfSignedCert confirms the camouflage cert is well-formed and usable in a
// tls.Config (it is never CA-verified — the client skips verification).
func TestSelfSignedCert(t *testing.T) {
	cert, err := SelfSignedCert("example.test")
	if err != nil {
		t.Fatalf("SelfSignedCert: %v", err)
	}
	if len(cert.Certificate) == 0 || cert.PrivateKey == nil {
		t.Fatal("cert is empty")
	}
	_ = &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS12}
}
