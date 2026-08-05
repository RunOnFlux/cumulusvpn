package wg

import (
	"net/netip"
	"sync/atomic"
	"testing"
)

// newTestForwarder builds a Forwarder exercising only the egress-policy fields.
// portAllowed touches neither dev nor lim, so nil is safe here.
func newTestForwarder(allowPorts []uint16, fleetAllow bool) *Forwarder {
	return NewForwarder(nil, nil, allowPorts, fleetAllow)
}

func TestPortAllowed(t *testing.T) {
	cases := []struct {
		name       string
		allowPorts []uint16 // nil => allow-all (minus SMTP)
		fleetAllow bool
		port       uint16
		isUDP      bool
		want       bool
	}{
		// --- SMTP hard-block: denied in every mode, TCP or UDP ---
		{"smtp 25 blocked in allow-all", nil, true, 25, false, false},
		{"smtp 465 blocked in allow-all", nil, true, 465, false, false},
		{"smtp 587 blocked in allow-all", nil, true, 587, false, false},
		{"smtp 25 blocked over udp", nil, true, 25, true, false},
		// The hard-block wins even if an operator lists an SMTP port.
		{"smtp 587 blocked despite allowlist", []uint16{587, 443}, true, 587, false, false},

		// --- allow-all mode (nil allowlist): everything non-SMTP passes ---
		{"allow-all permits 443", nil, true, 443, false, true},
		{"allow-all permits 80", nil, true, 80, false, true},
		{"allow-all permits arbitrary high port udp", nil, true, 40000, true, true},

		// --- restrictive allowlist: only listed non-SMTP ports pass ---
		{"allowlist permits listed 443", []uint16{80, 443}, false, 443, false, true},
		{"allowlist permits listed 80 udp", []uint16{80, 443}, false, 80, true, true},
		{"allowlist denies unlisted 8080", []uint16{80, 443}, false, 8080, false, false},

		// --- UDP:51820 fleet-allow branch, TCP vs UDP ---
		// Under a restrictive allowlist that omits 51820, fleetAllow widens
		// ONLY UDP:51820 (multi-hop ENTRY->EXIT), never TCP:51820.
		{"fleet-allow permits udp 51820", []uint16{443}, true, wgFleetPort, true, true},
		{"fleet-allow does NOT permit tcp 51820", []uint16{443}, true, wgFleetPort, false, false},
		{"fleet-allow off denies udp 51820", []uint16{443}, false, wgFleetPort, true, false},
		// If 51820 is explicitly allowlisted, both transports pass regardless
		// of fleetAllow (the allowlist check comes first).
		{"explicit 51820 in allowlist permits tcp", []uint16{51820}, false, wgFleetPort, false, true},
		{"explicit 51820 in allowlist permits udp", []uint16{51820}, false, wgFleetPort, true, true},
		// fleet-allow must not widen some other UDP port.
		{"fleet-allow does not widen udp 5353", []uint16{443}, true, 5353, true, false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newTestForwarder(tc.allowPorts, tc.fleetAllow)
			if got := f.portAllowed(tc.port, tc.isUDP); got != tc.want {
				t.Errorf("portAllowed(port=%d, isUDP=%v) = %v, want %v", tc.port, tc.isUDP, got, tc.want)
			}
		})
	}
}

// TestDestAllowed guards the SSRF filter: an enrolled client must not be able to
// reach the node's own network / cloud metadata / other internal services
// through the exit. Only globally-routable destinations are forwarded.
func TestDestAllowed(t *testing.T) {
	blocked := []string{
		"127.0.0.1",       // loopback (the gateway's own control API)
		"::1",             // loopback v6
		"169.254.169.254", // cloud metadata
		"169.254.0.1",     // link-local
		"10.0.0.5",        // RFC1918
		"172.16.0.1",      // RFC1918
		"192.168.1.1",     // RFC1918
		"100.64.0.1",      // CGNAT
		"fc00::1",         // ULA (IsPrivate v6)
		"fe80::1",         // link-local v6
		"0.0.0.0",         // unspecified
		"224.0.0.1",       // multicast
	}
	allowed := []string{
		"1.1.1.1",              // public resolver
		"8.8.8.8",              // public
		"93.184.216.34",        // public web
		"2606:4700:4700::1111", // public v6
	}

	f := newTestForwarder(nil, true) // allowPrivate defaults false
	for _, s := range blocked {
		ip := netip.MustParseAddr(s)
		if f.destAllowed(ip) {
			t.Errorf("destAllowed(%s) = true, want false (SSRF guard)", s)
		}
	}
	for _, s := range allowed {
		ip := netip.MustParseAddr(s)
		if !f.destAllowed(ip) {
			t.Errorf("destAllowed(%s) = false, want true (public)", s)
		}
	}

	// The dev/test override lets private destinations through.
	f.SetAllowPrivateEgress(true)
	if !f.destAllowed(netip.MustParseAddr("192.168.1.1")) {
		t.Error("with AllowPrivateEgress, destAllowed(192.168.1.1) should be true")
	}
}

// A forwarded flow commits a host socket, two goroutines and two pump buffers
// BEFORE the peer's token bucket sees a single byte — so the rate limiter cannot
// bound it. maxFlows is what stops one peer's flow flood from exhausting the
// container's memory and taking every other peer on the node down with it.
func TestAcquireFlowCapsConcurrency(t *testing.T) {
	var n atomic.Int64
	for i := 0; i < maxFlows; i++ {
		if !acquireFlow(&n) {
			t.Fatalf("flow %d refused below the cap", i)
		}
	}
	if acquireFlow(&n) {
		t.Fatal("a flow past the cap must be refused")
	}
	if got := n.Load(); got != maxFlows {
		t.Errorf("a refused flow must not consume a slot: count=%d want=%d", got, maxFlows)
	}
	// Releasing frees capacity again — a burst must not permanently wedge the node.
	releaseFlow(&n)
	if !acquireFlow(&n) {
		t.Error("a released slot must be reusable")
	}
}
