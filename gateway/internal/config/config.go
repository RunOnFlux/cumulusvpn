// Package config loads gateway configuration from environment variables.
//
// All CumulusVPN-specific variables are prefixed CVPN_ and are set in the Flux
// app spec (the single source of truth shared by every gateway instance — see
// docs/04-payments.md "Price in FLUX vs $0.99"). FLUX_NODE_HOST_IP and
// FLUX_APP_NAME are injected into every container by FluxOS itself.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// Fixed ports. These are host-mapped 1:1 by the Flux app spec, so they are
// constants of the protocol rather than tunables.
const (
	// WGListenPort is the vanilla WireGuard UDP listen port.
	WGListenPort = 51820
	// APIPort is the control API (enroll/status/info) TCP port.
	APIPort = 51821
	// WGObfsPort is the obfuscated (AmneziaWG) WireGuard UDP listen port. It
	// rides the UDP side of the already-listed API port (51821 is TCP for the
	// API, UDP for obfs), so the DPI-resistant transport costs no extra Flux
	// port (docs/15-transports.md). Enabled by CVPN_OBFS_ENABLE.
	WGObfsPort = APIPort
)

// Config is the fully resolved gateway configuration.
type Config struct {
	// PriceFlux is the monthly price in FLUX (e.g. 20). Canonical value
	// lives in the app spec env so all gateways agree without an oracle.
	PriceFlux float64
	// PaymentAddress is the transparent FLUX address payments are sent to.
	PaymentAddress string
	// DirectoryPubKey is the ed25519 public key (base64) that signs
	// directory.json; clients verify it, the gateway just republishes it.
	DirectoryPubKey string
	// FreeRateKBps is the free-tier rate limit in kilobytes per second.
	FreeRateKBps int
	// PremiumRateMbps is the premium per-peer ceiling in megabits per second.
	// Sized below a Flux node's ~100 Mbit/s uplink so one peer can't hog the
	// link (default 50 Mbit/s).
	PremiumRateMbps int
	// MaxPeersFree caps the number of enrolled free-tier peers.
	MaxPeersFree int
	// MaxPeersTotal caps total enrolled peers (free + premium).
	MaxPeersTotal int
	// CapacityMbps is the node's aggregate egress capacity in megabits/s — the
	// denominator for the throughput component of the /v1/info load figure.
	// Datacenter default 1000 (1 Gbit/s uplink).
	CapacityMbps int
	// EgressAllowPorts, when non-empty, is a destination-port allowlist for
	// forwarded traffic. Empty means "allow everything except the hard SMTP
	// blocklist". docs/06-legal-abuse.md says v1 launches with a
	// conservative allowlist (80/443/8080/DNS/QUIC/...).
	//
	// MULTI-HOP CAVEAT (docs/11-multihop.md): opt-in multi-hop makes the ENTRY
	// gateway forward a premium peer's traffic to another gateway's :51820/udp
	// (the EXIT). With an empty allowlist (allow-all-minus-SMTP) this already
	// works. But if a RESTRICTIVE CVPN_EGRESS_ALLOW_PORTS is configured and it
	// omits 51820, gateway-to-gateway forwarding is blocked and multi-hop
	// breaks. GatewayFleetAllow (below) keeps 51820/udp implicitly reachable.
	EgressAllowPorts []uint16

	// GatewayFleetAllow, when true (default), implicitly permits UDP 51820
	// (the WireGuard fleet port) as an egress destination even under a
	// restrictive EgressAllowPorts, so multi-hop ENTRY->EXIT forwarding keeps
	// working without having to remember to add 51820 to the allowlist. Set
	// CVPN_GATEWAY_FLEET_ALLOW=false to disable (also disables multi-hop entry).
	GatewayFleetAllow bool

	// NodeHostIP is the public IP of the Flux node hosting this container
	// (FLUX_NODE_HOST_IP, injected by FluxOS). Used for daemon API calls.
	NodeHostIP string
	// AppName is the Flux app name (FLUX_APP_NAME, injected by FluxOS).
	AppName string

	// KeyFile is where the server WireGuard private key is persisted so
	// restarts keep the same identity. Loss is survivable (clients
	// re-enroll via discovery) but churny.
	KeyFile string

	// ObfsEnable turns on the DPI-resistant AmneziaWG listener on WGObfsPort
	// (docs/15-transports.md). Off by default; when off the gateway serves only
	// vanilla WireGuard and does not advertise the obfuscated transport, so a
	// 0.2.0 image with obfs disabled behaves exactly like 0.1.0. Set via
	// CVPN_OBFS_ENABLE.
	ObfsEnable bool

	// TLSEnable turns on the WG-over-TLS "stealth" listener (transport wg-tls,
	// docs/15-transports.md): WireGuard tunnelled inside an ordinary-looking TLS
	// session so it survives both the WG fingerprint and UDP/port blocking. Off
	// by default. Set via CVPN_TLS_ENABLE.
	TLSEnable bool
	// TLSPort is the TCP port the TLS relay listens on. Default WGListenPort
	// (the free TCP side of the WG UDP port → no extra Flux port); set to 443 on
	// a stealth-subset node for HTTPS camouflage. Set via CVPN_TLS_PORT.
	TLSPort int
	// TLSSNI is the server name the client presents / the self-signed cert CN.
	// Cosmetic (the cert is camouflage only), but a plausible value blends in.
	// Set via CVPN_TLS_SNI.
	TLSSNI string
}

// Load reads configuration from the environment, applying documented defaults
// and validating required values.
func Load() (*Config, error) {
	cfg := &Config{
		PriceFlux:         envFloat("CVPN_PRICE_FLUX", 0),
		PaymentAddress:    os.Getenv("CVPN_PAYMENT_ADDRESS"),
		DirectoryPubKey:   os.Getenv("CVPN_DIRECTORY_PUBKEY"),
		FreeRateKBps:      envInt("CVPN_FREE_RATE_KBPS", 100),
		PremiumRateMbps:   envInt("CVPN_PREMIUM_RATE_MBPS", 50),
		MaxPeersFree:      envInt("CVPN_MAX_PEERS_FREE", 500),
		MaxPeersTotal:     envInt("CVPN_MAX_PEERS_TOTAL", 2000),
		CapacityMbps:      envInt("CVPN_CAPACITY_MBPS", 1000),
		NodeHostIP:        os.Getenv("FLUX_NODE_HOST_IP"),
		AppName:           os.Getenv("FLUX_APP_NAME"),
		KeyFile:           envStr("CVPN_KEY_FILE", "/data/server.key"),
		GatewayFleetAllow: envBool("CVPN_GATEWAY_FLEET_ALLOW", true),
		ObfsEnable:        envBool("CVPN_OBFS_ENABLE", false),
		TLSEnable:         envBool("CVPN_TLS_ENABLE", false),
		TLSPort:           envInt("CVPN_TLS_PORT", WGListenPort),
		TLSSNI:            os.Getenv("CVPN_TLS_SNI"),
	}

	if v := os.Getenv("CVPN_EGRESS_ALLOW_PORTS"); v != "" {
		for _, part := range strings.Split(v, ",") {
			part = strings.TrimSpace(part)
			if part == "" {
				continue
			}
			p, err := strconv.ParseUint(part, 10, 16)
			if err != nil {
				return nil, fmt.Errorf("config: bad port %q in CVPN_EGRESS_ALLOW_PORTS: %w", part, err)
			}
			cfg.EgressAllowPorts = append(cfg.EgressAllowPorts, uint16(p))
		}
	}

	if cfg.PriceFlux <= 0 {
		return nil, fmt.Errorf("config: CVPN_PRICE_FLUX is required and must be > 0")
	}
	if cfg.PaymentAddress == "" {
		return nil, fmt.Errorf("config: CVPN_PAYMENT_ADDRESS is required")
	}
	// POC: validate PaymentAddress is a well-formed transparent FLUX address
	// (base58check, t1/t3 prefix) so a typo in the app spec fails loudly.

	if cfg.MaxPeersFree > cfg.MaxPeersTotal {
		return nil, fmt.Errorf("config: CVPN_MAX_PEERS_FREE (%d) > CVPN_MAX_PEERS_TOTAL (%d)", cfg.MaxPeersFree, cfg.MaxPeersTotal)
	}

	return cfg, nil
}

func envStr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def // POC: log a warning instead of silently defaulting.
	}
	return n
}

func envBool(key string, def bool) bool {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return def // POC: log a warning instead of silently defaulting.
	}
	return b
}

func envFloat(key string, def float64) float64 {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	f, err := strconv.ParseFloat(v, 64)
	if err != nil {
		return def
	}
	return f
}
