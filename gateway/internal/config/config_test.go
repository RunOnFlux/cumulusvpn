package config

import (
	"reflect"
	"testing"
)

// allCVPNEnv is every variable Load reads. Each test clears them all (via
// t.Setenv "") so it runs against a known-empty environment regardless of what
// the developer or CI has exported.
var allCVPNEnv = []string{
	"CVPN_PRICE_FLUX",
	"CVPN_PRICE_SCHEDULE",
	"CVPN_PAYMENT_ADDRESS",
	"CVPN_DIRECTORY_PUBKEY",
	"CVPN_FREE_RATE_KBPS",
	"CVPN_PREMIUM_RATE_MBPS",
	"CVPN_MAX_PEERS_FREE",
	"CVPN_MAX_PEERS_TOTAL",
	"CVPN_EGRESS_ALLOW_PORTS",
	"CVPN_GATEWAY_FLEET_ALLOW",
	"CVPN_KEY_FILE",
	"FLUX_NODE_HOST_IP",
	"FLUX_APP_NAME",
}

// clearEnv blanks every CVPN/FLUX variable, then applies set. An empty string
// is treated as "unset" by Load's env helpers, so this yields a clean slate.
func clearEnv(t *testing.T, set map[string]string) {
	t.Helper()
	for _, k := range allCVPNEnv {
		t.Setenv(k, "")
	}
	for k, v := range set {
		t.Setenv(k, v)
	}
}

// minimal is the smallest set of required vars for a successful Load.
func minimal() map[string]string {
	return map[string]string{
		"CVPN_PRICE_FLUX":      "4.5",
		"CVPN_PAYMENT_ADDRESS": "t1abcPaymentAddress",
	}
}

func TestLoadDefaults(t *testing.T) {
	clearEnv(t, minimal())

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v, want nil", err)
	}
	if got := cfg.PriceSchedule.String(); got != "4.5@0" {
		t.Errorf("PriceSchedule = %v, want flat 4.5", got)
	}
	if cfg.PaymentAddress != "t1abcPaymentAddress" {
		t.Errorf("PaymentAddress = %q", cfg.PaymentAddress)
	}
	if cfg.FreeRateKBps != 100 {
		t.Errorf("FreeRateKBps = %d, want default 100", cfg.FreeRateKBps)
	}
	if cfg.PremiumRateMbps != 50 {
		t.Errorf("PremiumRateMbps = %d, want default 50", cfg.PremiumRateMbps)
	}
	if cfg.MaxPeersFree != 500 {
		t.Errorf("MaxPeersFree = %d, want default 500", cfg.MaxPeersFree)
	}
	if cfg.MaxPeersTotal != 2000 {
		t.Errorf("MaxPeersTotal = %d, want default 2000", cfg.MaxPeersTotal)
	}
	if cfg.KeyFile != "/data/server.key" {
		t.Errorf("KeyFile = %q, want default /data/server.key", cfg.KeyFile)
	}
	if !cfg.GatewayFleetAllow {
		t.Errorf("GatewayFleetAllow = false, want default true")
	}
	if len(cfg.EgressAllowPorts) != 0 {
		t.Errorf("EgressAllowPorts = %v, want empty", cfg.EgressAllowPorts)
	}
}

func TestLoadEnvParsing(t *testing.T) {
	clearEnv(t, map[string]string{
		"CVPN_PRICE_FLUX":          "9.99",
		"CVPN_PAYMENT_ADDRESS":     "t3zPay",
		"CVPN_DIRECTORY_PUBKEY":    "base64pubkey",
		"CVPN_FREE_RATE_KBPS":      "250",
		"CVPN_PREMIUM_RATE_MBPS":   "80",
		"CVPN_MAX_PEERS_FREE":      "10",
		"CVPN_MAX_PEERS_TOTAL":     "100",
		"CVPN_EGRESS_ALLOW_PORTS":  "80, 443 ,8080",
		"CVPN_GATEWAY_FLEET_ALLOW": "false",
		"CVPN_KEY_FILE":            "/custom/key",
		"FLUX_NODE_HOST_IP":        "203.0.113.7",
		"FLUX_APP_NAME":            "cumulusvpn-gw",
	})

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v, want nil", err)
	}
	if got := cfg.PriceSchedule.String(); got != "9.99@0" {
		t.Errorf("PriceSchedule = %v, want flat 9.99", got)
	}
	if cfg.DirectoryPubKey != "base64pubkey" {
		t.Errorf("DirectoryPubKey = %q", cfg.DirectoryPubKey)
	}
	if cfg.FreeRateKBps != 250 {
		t.Errorf("FreeRateKBps = %d, want 250", cfg.FreeRateKBps)
	}
	if cfg.PremiumRateMbps != 80 {
		t.Errorf("PremiumRateMbps = %d, want 80", cfg.PremiumRateMbps)
	}
	if cfg.KeyFile != "/custom/key" {
		t.Errorf("KeyFile = %q, want /custom/key", cfg.KeyFile)
	}
	if cfg.NodeHostIP != "203.0.113.7" {
		t.Errorf("NodeHostIP = %q", cfg.NodeHostIP)
	}
	if cfg.AppName != "cumulusvpn-gw" {
		t.Errorf("AppName = %q", cfg.AppName)
	}
	if cfg.GatewayFleetAllow {
		t.Errorf("GatewayFleetAllow = true, want false from env")
	}
	// Whitespace-trimmed, comma-split, order-preserving.
	if want := []uint16{80, 443, 8080}; !reflect.DeepEqual(cfg.EgressAllowPorts, want) {
		t.Errorf("EgressAllowPorts = %v, want %v", cfg.EgressAllowPorts, want)
	}
}

func TestLoadInvalidIntFallsBackToDefault(t *testing.T) {
	// envInt swallows a parse error and returns the default (documented POC
	// behavior) rather than failing Load.
	clearEnv(t, map[string]string{
		"CVPN_PRICE_FLUX":      "1",
		"CVPN_PAYMENT_ADDRESS": "t1x",
		"CVPN_FREE_RATE_KBPS":  "not-a-number",
	})
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v, want nil", err)
	}
	if cfg.FreeRateKBps != 100 {
		t.Errorf("FreeRateKBps = %d, want default 100 on bad int", cfg.FreeRateKBps)
	}
}

func TestLoadErrors(t *testing.T) {
	cases := []struct {
		name string
		env  map[string]string
	}{
		{"missing price", map[string]string{"CVPN_PAYMENT_ADDRESS": "t1x"}},
		{"zero price", map[string]string{"CVPN_PRICE_FLUX": "0", "CVPN_PAYMENT_ADDRESS": "t1x"}},
		{"negative price", map[string]string{"CVPN_PRICE_FLUX": "-1", "CVPN_PAYMENT_ADDRESS": "t1x"}},
		{"missing payment address", map[string]string{"CVPN_PRICE_FLUX": "4.5"}},
		{"infinite legacy price", map[string]string{"CVPN_PRICE_FLUX": "Inf", "CVPN_PAYMENT_ADDRESS": "t1x"}},
		{"exponent legacy price", map[string]string{"CVPN_PRICE_FLUX": "1e3", "CVPN_PAYMENT_ADDRESS": "t1x"}},
		{"schedule in the legacy variable", map[string]string{"CVPN_PRICE_FLUX": "20@0,12@9", "CVPN_PAYMENT_ADDRESS": "t1x"}},
		{"malformed schedule", map[string]string{
			"CVPN_PRICE_SCHEDULE":  "20@0,12",
			"CVPN_PAYMENT_ADDRESS": "t1x",
		}},
		{"bad egress port", map[string]string{
			"CVPN_PRICE_FLUX":         "4.5",
			"CVPN_PAYMENT_ADDRESS":    "t1x",
			"CVPN_EGRESS_ALLOW_PORTS": "80,notaport",
		}},
		{"port out of uint16 range", map[string]string{
			"CVPN_PRICE_FLUX":         "4.5",
			"CVPN_PAYMENT_ADDRESS":    "t1x",
			"CVPN_EGRESS_ALLOW_PORTS": "70000",
		}},
		{"free peers exceed total", map[string]string{
			"CVPN_PRICE_FLUX":      "4.5",
			"CVPN_PAYMENT_ADDRESS": "t1x",
			"CVPN_MAX_PEERS_FREE":  "3000",
			"CVPN_MAX_PEERS_TOTAL": "2000",
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			clearEnv(t, tc.env)
			if _, err := Load(); err == nil {
				t.Errorf("Load() error = nil, want error")
			}
		})
	}
}

func TestResolvePrice(t *testing.T) {
	env := func(kv map[string]string) func(string) string {
		return func(k string) string { return kv[k] }
	}
	cases := []struct {
		name, want string
		warn       bool
		env        map[string]string
	}{
		{"legacy flat price", "20@0", false, map[string]string{"CVPN_PRICE_FLUX": "20"}},
		{"schedule wins over the legacy price", "20@0,12@2215000", false, map[string]string{
			"CVPN_PRICE_FLUX": "12", "CVPN_PRICE_SCHEDULE": "20@0,12@2215000",
		}},
		{"schedule alone", "20@0,12@9", false, map[string]string{"CVPN_PRICE_SCHEDULE": "20,12@9"}},
		// Old images read CVPN_PRICE_FLUX, so a disagreement means the fleet
		// charges two prices — worth a loud log, not a crash loop.
		{"legacy price disagrees with the schedule", "20@0,12@9", true, map[string]string{
			"CVPN_PRICE_FLUX": "20", "CVPN_PRICE_SCHEDULE": "20@0,12@9",
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			sched, warn, err := ResolvePrice(env(tc.env))
			if err != nil {
				t.Fatal(err)
			}
			if got := sched.String(); got != tc.want {
				t.Errorf("schedule = %s, want %s", got, tc.want)
			}
			if (warn != "") != tc.warn {
				t.Errorf("warning = %q, want warning=%v", warn, tc.warn)
			}
		})
	}
}

func TestEnvBool(t *testing.T) {
	cases := []struct {
		name string
		val  string // "" means the var is unset
		def  bool
		want bool
	}{
		{"unset uses default true", "", true, true},
		{"unset uses default false", "", false, false},
		{"true", "true", false, true},
		{"false", "false", true, false},
		{"1 is true", "1", false, true},
		{"0 is false", "0", true, false},
		{"invalid falls back to default true", "yesplease", true, true},
		{"invalid falls back to default false", "nope", false, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			const key = "CVPN_TEST_BOOL"
			t.Setenv(key, tc.val) // "" is treated as unset by envBool
			if got := envBool(key, tc.def); got != tc.want {
				t.Errorf("envBool(%q, %v) = %v, want %v", tc.val, tc.def, got, tc.want)
			}
		})
	}
}
