package wg

import "testing"

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
