package dnsproxy

import (
	"context"
	"net/netip"
	"os"
	"testing"
)

// TestLiveProviders resolves a name through every built-in provider over real
// DoH, exactly as a gateway does (system roots, dialing the resolver's own
// addresses). Opt-in: it needs the internet. Run before changing Providers:
//
//	CVPN_LIVE_DNS=1 go test ./internal/dnsproxy -run TestLiveProviders -v
func TestLiveProviders(t *testing.T) {
	if os.Getenv("CVPN_LIVE_DNS") == "" {
		t.Skip("set CVPN_LIVE_DNS=1 to query the real resolvers")
	}
	p := New(Options{Plain: func(context.Context, netip.Addr, []byte) ([]byte, error) {
		t.Error("fell back to plain DNS")
		return nil, errBadResponse
	}})
	for _, pr := range Providers {
		for _, a := range pr.Addrs {
			resp, err := p.Exchange(context.Background(), a, buildQuery(t, 0x5150, "example.com.", 1232))
			if err != nil {
				t.Errorf("%s via %v: %v", pr.Name, a, err)
				continue
			}
			if messageID(resp) != 0x5150 || checkResponse(resp) != nil {
				t.Errorf("%s via %v: bad answer", pr.Name, a)
				continue
			}
			t.Logf("%-20s %-16v ok (%d bytes)", pr.Name, a, len(resp))
		}
	}
	if s := p.Stats(); s.Fallbacks != 0 {
		t.Fatalf("stats %+v: some lookups were not encrypted", s)
	}
}
