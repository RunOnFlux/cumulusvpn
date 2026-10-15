package dnsproxy

import (
	"context"
	"crypto/x509"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"sync/atomic"
	"testing"

	"golang.org/x/net/dns/dnsmessage"
)

// testResolver is the address clients "send" lookups to in these tests. It is
// documentation space, so nothing real ever answers it.
var testResolver = netip.MustParseAddr("192.0.2.53")

// buildQuery makes a wire-format A query for name; udpSize > 0 adds an EDNS
// OPT record advertising that UDP payload size.
func buildQuery(t *testing.T, id uint16, name string, udpSize int) []byte {
	t.Helper()
	b := dnsmessage.NewBuilder(nil, dnsmessage.Header{ID: id, RecursionDesired: true})
	b.EnableCompression()
	must(t, b.StartQuestions())
	must(t, b.Question(dnsmessage.Question{
		Name: dnsmessage.MustNewName(name), Type: dnsmessage.TypeA, Class: dnsmessage.ClassINET,
	}))
	if udpSize > 0 {
		must(t, b.StartAdditionals())
		var opt dnsmessage.ResourceHeader
		must(t, opt.SetEDNS0(udpSize, dnsmessage.RCodeSuccess, false))
		must(t, b.OPTResource(opt, dnsmessage.OPTResource{}))
	}
	m, err := b.Finish()
	must(t, err)
	return m
}

// buildAnswer answers query with n A records (n large = a big response).
func buildAnswer(t *testing.T, query []byte, n int) []byte {
	t.Helper()
	var p dnsmessage.Parser
	h, err := p.Start(query)
	must(t, err)
	q, err := p.Question()
	must(t, err)
	h.Response = true
	b := dnsmessage.NewBuilder(nil, h)
	b.EnableCompression()
	must(t, b.StartQuestions())
	must(t, b.Question(q))
	must(t, b.StartAnswers())
	for i := 0; i < n; i++ {
		must(t, b.AResource(
			dnsmessage.ResourceHeader{Name: q.Name, Class: dnsmessage.ClassINET, TTL: 60},
			dnsmessage.AResource{A: [4]byte{203, 0, 113, byte(i)}},
		))
	}
	m, err := b.Finish()
	must(t, err)
	return m
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

// dohServer is a TLS HTTP/2 DoH endpoint. handler answers each request; the
// returned counter tracks how many arrived.
func dohServer(t *testing.T, handler http.HandlerFunc) (*httptest.Server, *atomic.Int32) {
	t.Helper()
	var hits atomic.Int32
	srv := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		handler(w, r)
	}))
	srv.EnableHTTP2 = true
	srv.StartTLS()
	t.Cleanup(srv.Close)
	return srv, &hits
}

// answeringDoH answers every well-formed POST with n A records, failing the
// test on anything that isn't RFC 8484 shaped (POST, media types, ID 0).
func answeringDoH(t *testing.T, n int) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/dns-query" {
			t.Errorf("DoH request %s %s, want POST /dns-query", r.Method, r.URL.Path)
		}
		if r.Header.Get("Content-Type") != mediaType || r.Header.Get("Accept") != mediaType {
			t.Errorf("DoH headers: content-type %q accept %q", r.Header.Get("Content-Type"), r.Header.Get("Accept"))
		}
		if r.ProtoMajor != 2 {
			t.Errorf("DoH over HTTP/%d, want HTTP/2", r.ProtoMajor)
		}
		q, _ := io.ReadAll(r.Body)
		if messageID(q) != 0 {
			t.Errorf("DoH wire ID = %d, want 0 (RFC 8484 §4.1)", messageID(q))
		}
		w.Header().Set("Content-Type", mediaType)
		_, _ = w.Write(buildAnswer(t, q, n))
	}
}

// newTestProxy points testResolver at srv, trusting its certificate.
func newTestProxy(t *testing.T, srv *httptest.Server, plain func(context.Context, netip.Addr, []byte) ([]byte, error)) *Proxy {
	t.Helper()
	roots := x509.NewCertPool()
	roots.AddCert(srv.Certificate())
	addr := strings.TrimPrefix(srv.URL, "https://")
	if plain == nil {
		plain = func(context.Context, netip.Addr, []byte) ([]byte, error) {
			t.Error("plain fallback used, want DoH")
			return nil, errors.New("no fallback in this test")
		}
	}
	return New(Options{
		// httptest's certificate is issued for example.com.
		Providers: []Provider{{Name: "test", Host: "example.com", Addrs: []netip.Addr{testResolver}}},
		RootCAs:   roots,
		DialAddr:  func(netip.Addr) string { return addr },
		Plain:     plain,
	})
}

func TestExchangeOverDoH(t *testing.T) {
	srv, hits := dohServer(t, answeringDoH(t, 1))
	p := newTestProxy(t, srv, nil)

	q := buildQuery(t, 0xBEEF, "example.org.", 0)
	resp, err := p.Exchange(context.Background(), testResolver, q)
	if err != nil {
		t.Fatalf("Exchange: %v", err)
	}
	if got := messageID(resp); got != 0xBEEF {
		t.Fatalf("answer ID = %#x, want the client's 0xBEEF", got)
	}
	if hits.Load() != 1 {
		t.Fatalf("DoH requests = %d, want 1", hits.Load())
	}
	if s := p.Stats(); s != (Stats{Encrypted: 1}) {
		t.Fatalf("stats = %+v, want 1 encrypted", s)
	}
}

func TestExchangeFallsBackToPlainWhenDoHFails(t *testing.T) {
	srv, _ := dohServer(t, func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "nope", http.StatusBadGateway)
	})
	q := buildQuery(t, 7, "example.org.", 0)
	var plainDst netip.Addr
	p := newTestProxy(t, srv, func(_ context.Context, dst netip.Addr, query []byte) ([]byte, error) {
		plainDst = dst
		return buildAnswer(t, query, 1), nil
	})

	resp, err := p.Exchange(context.Background(), testResolver, q)
	if err != nil {
		t.Fatalf("Exchange: %v", err)
	}
	if messageID(resp) != 7 {
		t.Fatalf("answer ID = %d, want 7", messageID(resp))
	}
	if plainDst != testResolver {
		t.Fatalf("fallback went to %v, want the resolver the client asked (%v)", plainDst, testResolver)
	}
	if s := p.Stats(); s != (Stats{Fallbacks: 1}) {
		t.Fatalf("stats = %+v, want 1 fallback", s)
	}
}

func TestBreakerSkipsDoHAfterRepeatedFailures(t *testing.T) {
	srv, hits := dohServer(t, func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "nope", http.StatusBadGateway)
	})
	p := newTestProxy(t, srv, func(_ context.Context, _ netip.Addr, query []byte) ([]byte, error) {
		return buildAnswer(t, query, 1), nil
	})
	for i := 0; i < breakerTrips+3; i++ {
		if _, err := p.Exchange(context.Background(), testResolver, buildQuery(t, uint16(i), "example.org.", 0)); err != nil {
			t.Fatalf("Exchange %d: %v", i, err)
		}
	}
	if got := hits.Load(); got != breakerTrips {
		t.Fatalf("DoH attempts = %d, want %d (then skipped for the cooldown)", got, breakerTrips)
	}
	if s := p.Stats(); s.Fallbacks != breakerTrips+3 {
		t.Fatalf("fallbacks = %d, want %d", s.Fallbacks, breakerTrips+3)
	}
}

func TestDoHOnlyProviderNeverFallsBack(t *testing.T) {
	srv, hits := dohServer(t, func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "nope", http.StatusBadGateway)
	})
	p := newTestProxy(t, srv, nil) // the plain stub fails the test if used
	for _, u := range p.upstreams {
		u.dohOnly = true
	}
	// Past the breaker's trip count DoH is still tried every time: skipping it
	// would only fail faster, and the first lookup after an outage should work.
	n := breakerTrips + 3
	for i := 0; i < n; i++ {
		if _, err := p.Exchange(context.Background(), testResolver, buildQuery(t, uint16(i), "example.org.", 0)); err == nil {
			t.Fatalf("Exchange %d succeeded, want the DoH failure", i)
		}
	}
	if got := hits.Load(); got != int32(n) {
		t.Fatalf("DoH attempts = %d, want %d (never skipped)", got, n)
	}
	if s := p.Stats(); s != (Stats{Failed: uint64(n)}) {
		t.Fatalf("stats = %+v, want %d failed and no fallbacks", s, n)
	}
}

func TestExchangeRejectsWhatIsNotAQuery(t *testing.T) {
	srv, hits := dohServer(t, answeringDoH(t, 1))
	p := newTestProxy(t, srv, nil)
	answer := buildAnswer(t, buildQuery(t, 1, "example.org.", 0), 1)
	for name, msg := range map[string][]byte{
		"garbage":  []byte("not dns at all, just bytes on port 53"),
		"short":    {0, 1, 2},
		"response": answer, // QR=1: a reply, not a query
	} {
		if _, err := p.Exchange(context.Background(), testResolver, msg); !errors.Is(err, ErrNotDNS) {
			t.Errorf("%s: err = %v, want ErrNotDNS", name, err)
		}
	}
	if hits.Load() != 0 {
		t.Fatalf("DoH requests = %d, want none for non-queries", hits.Load())
	}
}

func TestExchangeIgnoresUnknownResolvers(t *testing.T) {
	srv, _ := dohServer(t, answeringDoH(t, 1))
	p := newTestProxy(t, srv, nil)
	other := netip.MustParseAddr("192.0.2.99")
	if p.Handles(other) {
		t.Fatal("Handles(unknown resolver) = true")
	}
	if _, err := p.Exchange(context.Background(), other, buildQuery(t, 1, "example.org.", 0)); err == nil {
		t.Fatal("Exchange to an unknown resolver succeeded")
	}
}

func TestExchangeShedsLoadOverMaxInFlight(t *testing.T) {
	release := make(chan struct{})
	srv, _ := dohServer(t, func(w http.ResponseWriter, r *http.Request) {
		<-release
		answeringDoH(t, 1)(w, r)
	})
	p := newTestProxy(t, srv, nil)
	p.slots = make(chan struct{}, 1)

	done := make(chan error, 1)
	go func() {
		_, err := p.Exchange(context.Background(), testResolver, buildQuery(t, 1, "example.org.", 0))
		done <- err
	}()
	// Wait until the first lookup holds the only slot.
	for len(p.slots) == 0 {
		select {
		case err := <-done:
			t.Fatalf("first lookup finished early: %v", err)
		default:
		}
	}
	if _, err := p.Exchange(context.Background(), testResolver, buildQuery(t, 2, "example.org.", 0)); !errors.Is(err, ErrBusy) {
		t.Fatalf("second lookup err = %v, want ErrBusy", err)
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatalf("first lookup: %v", err)
	}
}

func TestFitUDP(t *testing.T) {
	noEDNS := buildQuery(t, 9, "example.org.", 0)
	edns4096 := buildQuery(t, 9, "example.org.", 4096)
	small := buildAnswer(t, noEDNS, 1)     // well under 512
	medium := buildAnswer(t, edns4096, 60) // between 512 and 1232
	large := buildAnswer(t, edns4096, 120) // over 1232
	if len(medium) <= minUDP || len(medium) > maxUDP || len(large) <= maxUDP {
		t.Fatalf("fixture sizes off: medium %d, large %d", len(medium), len(large))
	}

	if got := FitUDP(noEDNS, small); len(got) != len(small) {
		t.Fatal("a small answer was changed")
	}
	if got := FitUDP(edns4096, medium); len(got) != len(medium) {
		t.Fatal("an answer within the client's EDNS size was truncated")
	}
	for name, c := range map[string]struct{ query, resp []byte }{
		"no EDNS, over 512":    {noEDNS, buildAnswer(t, noEDNS, 60)},
		"EDNS 4096, over 1232": {edns4096, large},
	} {
		got := FitUDP(c.query, c.resp)
		if !isTruncated(got) {
			t.Fatalf("%s: TC not set", name)
		}
		var p dnsmessage.Parser
		h, err := p.Start(got)
		must(t, err)
		qs, err := p.AllQuestions()
		must(t, err)
		if h.ID != 9 || len(qs) != 1 || qs[0].Name.String() != "example.org." {
			t.Fatalf("%s: truncated reply lost its ID or question: %+v %+v", name, h, qs)
		}
		if _, err := p.AnswerHeader(); err == nil {
			t.Fatalf("%s: truncated reply still carries answers", name)
		}
	}
}

func TestProvidersTable(t *testing.T) {
	seen := map[netip.Addr]string{}
	for _, pr := range Providers {
		if pr.Name == "" || pr.Host == "" || len(pr.Addrs) == 0 {
			t.Fatalf("incomplete provider %+v", pr)
		}
		for _, a := range pr.Addrs {
			if !a.Is4() || a.IsPrivate() || a.IsLoopback() {
				t.Fatalf("%s: %v is not a public IPv4 resolver address", pr.Name, a)
			}
			if other, dup := seen[a]; dup {
				t.Fatalf("%v listed for both %s and %s", a, other, pr.Name)
			}
			seen[a] = pr.Name
		}
	}
	// Only Mullvad is known to refuse ordinary DNS; marking a resolver that
	// does answer it as DoHOnly would throw away its fallback for nothing.
	for _, pr := range Providers {
		if pr.DoHOnly != (pr.Name == "mullvad") {
			t.Fatalf("%s: DoHOnly = %v", pr.Name, pr.DoHOnly)
		}
	}
	// The fleet advertises 1.1.1.1; it must always be encrypted.
	if !New(Options{}).Handles(netip.MustParseAddr("1.1.1.1")) {
		t.Fatal("the advertised resolver 1.1.1.1 is not handled")
	}
}
