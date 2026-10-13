package wg

import (
	"context"
	"crypto/x509"
	"encoding/binary"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/runonflux/cumulusvpn-gateway/internal/dnsproxy"

	"golang.org/x/net/dns/dnsmessage"
)

// dnsAnswerIP is what the fake DoH resolver answers for every name, so a
// lookup that reached it is unmistakable (the real 1.1.1.1 never returns
// documentation space).
var dnsAnswerIP = [4]byte{203, 0, 113, 7}

// TestDNSThroughTunnelIsEncrypted is the guard for gateway-side encrypted DNS:
// a real WireGuard client sends ordinary DNS to 1.1.1.1 through the tunnel,
// over UDP and over TCP, and gets the answer from the DoH resolver the gateway
// forwarded it to, never from a plain-text relay to 1.1.1.1:53.
func TestDNSThroughTunnelIsEncrypted(t *testing.T) {
	var dohHits atomic.Int32
	doh := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		dohHits.Add(1)
		q, _ := io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/dns-message")
		_, _ = w.Write(answerA(t, q, dnsAnswerIP))
	}))
	doh.EnableHTTP2 = true
	doh.StartTLS()
	t.Cleanup(doh.Close)

	roots := x509.NewCertPool()
	roots.AddCert(doh.Certificate())
	dohAddr := strings.TrimPrefix(doh.URL, "https://")
	proxy := dnsproxy.New(dnsproxy.Options{
		// httptest's certificate is issued for example.com.
		Providers: []dnsproxy.Provider{{
			Name: "test", Host: "example.com", Addrs: []netip.Addr{netip.MustParseAddr("1.1.1.1")},
		}},
		RootCAs:  roots,
		DialAddr: func(netip.Addr) string { return dohAddr },
		Plain: func(context.Context, netip.Addr, []byte) ([]byte, error) {
			t.Error("lookup fell back to plain DNS")
			return nil, errors.New("no plain DNS in this test")
		},
	})

	tnet := startTunnel(t, nil, func(f *Forwarder) { f.SetDNS(proxy) })

	t.Run("udp", func(t *testing.T) {
		const id = 0x1234
		var resp []byte
		deadline := time.Now().Add(15 * time.Second)
		for resp == nil && time.Now().Before(deadline) {
			// Retry: the first datagrams may be lost while the WG handshake completes.
			resp = udpLookup(t, tnet, id, "example.org.")
		}
		if resp == nil {
			t.Fatal("no UDP answer through the tunnel")
		}
		checkA(t, resp, id, dnsAnswerIP)
	})

	t.Run("tcp", func(t *testing.T) {
		const id = 0x4321
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		c, err := tnet.DialContext(ctx, "tcp", "1.1.1.1:53")
		if err != nil {
			t.Fatalf("dial tcp 1.1.1.1:53 through the tunnel: %v", err)
		}
		defer c.Close()
		_ = c.SetDeadline(time.Now().Add(10 * time.Second))
		q := queryA(t, id, "example.org.")
		msg := make([]byte, 2+len(q))
		binary.BigEndian.PutUint16(msg, uint16(len(q)))
		copy(msg[2:], q)
		if _, err := c.Write(msg); err != nil {
			t.Fatalf("write: %v", err)
		}
		var lenBuf [2]byte
		if _, err := io.ReadFull(c, lenBuf[:]); err != nil {
			t.Fatalf("read length: %v", err)
		}
		resp := make([]byte, binary.BigEndian.Uint16(lenBuf[:]))
		if _, err := io.ReadFull(c, resp); err != nil {
			t.Fatalf("read answer: %v", err)
		}
		checkA(t, resp, id, dnsAnswerIP)
	})

	if dohHits.Load() < 2 {
		t.Fatalf("DoH resolver saw %d lookups, want at least 2", dohHits.Load())
	}
	if s := proxy.Stats(); s.Encrypted < 2 || s.Fallbacks != 0 {
		t.Fatalf("proxy stats = %+v, want only encrypted lookups", s)
	}
}

// udpLookup sends one A query to 1.1.1.1:53 through the tunnel; nil on timeout.
func udpLookup(t *testing.T, tnet interface {
	DialContext(context.Context, string, string) (net.Conn, error)
}, id uint16, name string) []byte {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	c, err := tnet.DialContext(ctx, "udp", "1.1.1.1:53")
	if err != nil {
		t.Fatalf("dial udp 1.1.1.1:53 through the tunnel: %v", err)
	}
	defer c.Close()
	_ = c.SetDeadline(time.Now().Add(time.Second))
	if _, err := c.Write(queryA(t, id, name)); err != nil {
		return nil
	}
	buf := make([]byte, 2048)
	n, err := c.Read(buf)
	if err != nil {
		return nil
	}
	return buf[:n]
}

func queryA(t *testing.T, id uint16, name string) []byte {
	t.Helper()
	b := dnsmessage.NewBuilder(nil, dnsmessage.Header{ID: id, RecursionDesired: true})
	if err := b.StartQuestions(); err != nil {
		t.Fatal(err)
	}
	if err := b.Question(dnsmessage.Question{
		Name: dnsmessage.MustNewName(name), Type: dnsmessage.TypeA, Class: dnsmessage.ClassINET,
	}); err != nil {
		t.Fatal(err)
	}
	m, err := b.Finish()
	if err != nil {
		t.Fatal(err)
	}
	return m
}

// answerA answers query with a single A record.
func answerA(t *testing.T, query []byte, ip [4]byte) []byte {
	t.Helper()
	var p dnsmessage.Parser
	h, err := p.Start(query)
	if err != nil {
		t.Errorf("DoH got a malformed query: %v", err)
		return nil
	}
	q, err := p.Question()
	if err != nil {
		t.Errorf("DoH query has no question: %v", err)
		return nil
	}
	h.Response = true
	b := dnsmessage.NewBuilder(nil, h)
	_ = b.StartQuestions()
	_ = b.Question(q)
	_ = b.StartAnswers()
	_ = b.AResource(dnsmessage.ResourceHeader{Name: q.Name, Class: dnsmessage.ClassINET, TTL: 60}, dnsmessage.AResource{A: ip})
	m, _ := b.Finish()
	return m
}

func checkA(t *testing.T, resp []byte, id uint16, want [4]byte) {
	t.Helper()
	var p dnsmessage.Parser
	h, err := p.Start(resp)
	if err != nil {
		t.Fatalf("answer: %v", err)
	}
	if h.ID != id || !h.Response {
		t.Fatalf("answer header %+v, want a response with ID %#x", h, id)
	}
	if err := p.SkipAllQuestions(); err != nil {
		t.Fatal(err)
	}
	if _, err := p.AnswerHeader(); err != nil {
		t.Fatalf("answer has no records: %v", err)
	}
	a, err := p.AResource()
	if err != nil {
		t.Fatalf("answer has no A record: %v", err)
	}
	if a.A != want {
		t.Fatalf("A = %v, want %v (the DoH resolver's answer)", a.A, want)
	}
}
