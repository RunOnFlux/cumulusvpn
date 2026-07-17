// Package api serves the control API on :51821 (docs/03-gateway.md "Control
// API"). It is deliberately tiny: enroll a peer, report a peer's tier, and
// self-describe. Response bodies are signed with a key derived from the
// server's WireGuard key so clients that learned the WG pubkey via discovery
// can verify they are talking to the real gateway (v1 pragmatic option: plain
// HTTP + signed bodies instead of TLS).
package api

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"sync"
	"time"

	"github.com/runonflux/cumulusvpn-gateway/internal/config"
	"github.com/runonflux/cumulusvpn-gateway/internal/entitle"
	"github.com/runonflux/cumulusvpn-gateway/internal/limiter"
	"github.com/runonflux/cumulusvpn-gateway/internal/wg"
)

// Version is the gateway build version, surfaced in /v1/info.
const Version = "0.1.0-poc"

// MinClientVersion is the oldest client the gateway will happily serve.
const MinClientVersion = "0.1.0"

// dnsServer is advertised to clients; forwarded like any other flow so client
// DNS never leaks via the node resolver (POC: run an in-process DoH/DoT
// resolver and hand out 10.8.0.1 as the DNS instead — docs/03-gateway.md).
const dnsServer = "1.1.1.1"

// Info self-description served at /v1/info.
type Info struct {
	Country          string  `json:"country"`
	Region           string  `json:"region"`
	City             string  `json:"city"`
	Load             float64 `json:"load"`     // 0..1 utilisation estimate
	Capacity         int     `json:"capacity"` // remaining peer slots
	Version          string  `json:"version"`
	ServerPubKey     string  `json:"server_pubkey"` // WG pubkey (base64)
	SignPubKey       string  `json:"sign_pubkey"`   // ed25519 verify key (base64)
	MinClientVersion string  `json:"min_client_version"`
}

// Server is the control API.
type Server struct {
	cfg          *config.Config
	dev          *wg.Device
	ent          *entitle.Engine
	lim          *limiter.Manager
	info         Info
	signKey      ed25519.PrivateKey
	nodePublicIP string // fallback endpoint IP from fluxnode hostinfo

	mu       sync.Mutex
	nextHost uint32               // rolling host part for 10.8.x.y assignment
	enrollIP map[string]time.Time // per-IP last enroll (rate limit)
	powSeen  map[string]struct{}  // spent PoW nonces (replay guard)
}

// New builds the control API server. info fields (geo) come from fluxnode;
// nodePublicIP is the hostinfo public IP used as the endpoint fallback when
// FLUX_NODE_HOST_IP is unset (local dev).
func New(cfg *config.Config, dev *wg.Device, ent *entitle.Engine, lim *limiter.Manager, info Info, nodePublicIP string) *Server {
	s := &Server{
		cfg:          cfg,
		dev:          dev,
		ent:          ent,
		lim:          lim,
		info:         info,
		nodePublicIP: nodePublicIP,
		nextHost:     2, // .0.1 is the gateway, start clients at .0.2
		enrollIP:     make(map[string]time.Time),
		powSeen:      make(map[string]struct{}),
	}
	s.signKey = deriveSignKey(dev.PrivateKey())
	s.info.ServerPubKey = dev.PublicKey()
	s.info.SignPubKey = base64.StdEncoding.EncodeToString(s.signKey.Public().(ed25519.PublicKey))
	s.info.Version = Version
	s.info.MinClientVersion = MinClientVersion
	return s
}

// Handler builds the HTTP routes.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/enroll", s.handleEnroll)
	mux.HandleFunc("/v1/status/", s.handleStatus)
	mux.HandleFunc("/v1/info", s.handleInfo)
	return mux
}

// --- enroll ---

type enrollRequest struct {
	PubKey   string `json:"pubkey"`
	PoWNonce string `json:"pow_nonce"` // hashcash-style solution over pubkey
}

type enrollResponse struct {
	ServerPubKey   string  `json:"server_pubkey"`
	Endpoint       string  `json:"endpoint"`
	AssignedIP     string  `json:"assigned_ip"`
	DNS            string  `json:"dns"`
	PaymentAddress string  `json:"payment_address"`
	PaymentMemo    string  `json:"payment_memo"`
	PriceFlux      float64 `json:"price_flux"`
}

func (s *Server) handleEnroll(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "method_not_allowed", "POST only")
		return
	}
	if !s.allowEnroll(clientIP(r)) {
		writeErr(w, http.StatusTooManyRequests, "rate_limited", "enroll rate limit")
		return
	}

	var req enrollRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", "invalid JSON")
		return
	}

	// Validate pubkey: base64 of exactly 32 bytes.
	raw, err := base64.StdEncoding.DecodeString(req.PubKey)
	if err != nil || len(raw) != 32 {
		writeErr(w, http.StatusBadRequest, "bad_pubkey", "pubkey must be base64 of 32 bytes")
		return
	}

	// Light hashcash PoW: require leading-zero-bits over sha256(pubkey||nonce).
	if !s.checkPoW(req.PubKey, req.PoWNonce) {
		writeErr(w, http.StatusForbidden, "bad_pow", "invalid or missing proof-of-work")
		return
	}

	// Capacity guards (docs/03-gateway.md "Capacity guards").
	premium, _ := s.ent.Tier(req.PubKey)
	free, total := s.lim.Counts()
	if _, already := s.dev.PeerAddr(req.PubKey); !already {
		if total >= s.cfg.MaxPeersTotal {
			writeErr(w, http.StatusServiceUnavailable, "at_capacity", "gateway full")
			return
		}
		if !premium && free >= s.cfg.MaxPeersFree {
			writeErr(w, http.StatusServiceUnavailable, "free_full", "free tier full")
			return
		}
	}

	// Assign (or reuse) a tunnel address and register the peer.
	assigned, err := s.assign(req.PubKey)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "assign_failed", err.Error())
		return
	}
	if err := s.dev.AddPeer(req.PubKey, assigned); err != nil {
		writeErr(w, http.StatusInternalServerError, "add_peer_failed", err.Error())
		return
	}
	// Ensure the limiter reflects the current tier immediately.
	s.lim.SetTier(req.PubKey, premium)

	resp := enrollResponse{
		ServerPubKey:   s.dev.PublicKey(),
		Endpoint:       fmt.Sprintf("%s:%d", s.publicIP(), config.WGListenPort),
		AssignedIP:     assigned.String(),
		DNS:            dnsServer,
		PaymentAddress: s.cfg.PaymentAddress,
		PaymentMemo:    "CVPN1:" + entitle.PaymentCode(req.PubKey),
		PriceFlux:      s.cfg.PriceFlux,
	}
	s.writeSigned(w, resp)
}

// assign returns the peer's existing address or the next free 10.8.x.y.
func (s *Server) assign(pubkey string) (netip.Addr, error) {
	if addr, ok := s.dev.PeerAddr(pubkey); ok {
		return addr, nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	// 10.8.0.0/16 minus .0.0 (network) and .0.1 (gateway). Walk host part.
	// POC: this is a simple monotonic allocator; a real one recycles freed
	// addresses and persists the map to /data/peers.cache.
	for i := 0; i < 65534; i++ {
		host := s.nextHost
		s.nextHost++
		if s.nextHost >= 1<<16 {
			s.nextHost = 2
		}
		b2 := byte(host >> 8)
		b3 := byte(host & 0xff)
		if b3 == 0 || b3 == 255 { // skip network/broadcast-ish hosts
			continue
		}
		addr := netip.AddrFrom4([4]byte{10, 8, b2, b3})
		if _, taken := s.dev.PeerByAddr(addr); !taken {
			return addr, nil
		}
	}
	return netip.Addr{}, fmt.Errorf("address pool exhausted")
}

// --- status ---

type statusResponse struct {
	Tier      string    `json:"tier"` // "free" | "premium"
	PaidUntil time.Time `json:"paid_until"`
	BytesUsed uint64    `json:"bytes_used"`
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	pubkey := strings.TrimPrefix(r.URL.Path, "/v1/status/")
	if pubkey == "" {
		writeErr(w, http.StatusBadRequest, "bad_request", "pubkey required")
		return
	}
	premium, paidUntil := s.ent.Tier(pubkey)
	tier := "free"
	if premium {
		tier = "premium"
	}
	resp := statusResponse{
		Tier:      tier,
		PaidUntil: paidUntil,
		BytesUsed: s.lim.Get(pubkey).Bytes(),
	}
	s.writeSigned(w, resp)
}

// --- info ---

func (s *Server) handleInfo(w http.ResponseWriter, _ *http.Request) {
	info := s.info
	free, total := s.lim.Counts()
	_ = free
	remaining := s.cfg.MaxPeersTotal - total
	if remaining < 0 {
		remaining = 0
	}
	info.Capacity = remaining
	// POC: replace with a real utilisation metric (aggregate throughput vs
	// benchmark, or CPU) so clients load-balance meaningfully.
	if s.cfg.MaxPeersTotal > 0 {
		info.Load = float64(total) / float64(s.cfg.MaxPeersTotal)
	}
	s.writeSigned(w, info)
}

// --- signing + helpers ---

// deriveSignKey turns the 32-byte WG private key into a stable ed25519 key by
// using sha256(wgPriv) as the ed25519 seed. POC: the design doc allows "the
// WG key or ed25519"; deriving a dedicated ed25519 key keeps signing off the
// curve25519 key and lets clients verify with sign_pubkey from /v1/info.
func deriveSignKey(wgPriv [32]byte) ed25519.PrivateKey {
	seed := sha256.Sum256(wgPriv[:])
	return ed25519.NewKeyFromSeed(seed[:])
}

// writeSigned marshals v, signs the JSON body, and returns it with an
// X-CVPN-Signature header (base64 ed25519 over the exact bytes).
func (s *Server) writeSigned(w http.ResponseWriter, v any) {
	body, err := json.Marshal(map[string]any{"status": "success", "data": v})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "encode_failed", err.Error())
		return
	}
	sig := ed25519.Sign(s.signKey, body)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-CVPN-Signature", base64.StdEncoding.EncodeToString(sig))
	w.Header().Set("X-CVPN-Sign-PubKey", s.info.SignPubKey)
	_, _ = w.Write(body)
}

func writeErr(w http.ResponseWriter, code int, name, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status": "error",
		"data":   map[string]string{"code": fmt.Sprint(code), "name": name, "message": msg},
	})
}

// allowEnroll is a simple per-IP token: one enroll per IP per 2s window.
// POC: replace with a proper per-IP token bucket + periodic map GC.
func (s *Server) allowEnroll(ip string) bool {
	const window = 2 * time.Second
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	if last, ok := s.enrollIP[ip]; ok && now.Sub(last) < window {
		return false
	}
	s.enrollIP[ip] = now
	return true
}

// publicIP is the node's public IP used to build the advertised WG endpoint.
// FLUX_NODE_HOST_IP is injected by FluxOS; the fluxnode hostinfo public IP is
// the fallback (stored on the Server at construction).
func (s *Server) publicIP() string {
	if s.cfg.NodeHostIP != "" {
		return s.cfg.NodeHostIP
	}
	return s.nodePublicIP
}

func clientIP(r *http.Request) string {
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}
