// Command gateway is the CumulusVPN exit gateway: one static Go binary that
// runs a userspace WireGuard device (netstack, no NET_ADMIN), forwards flows
// to the internet as a VPN exit, enforces free/paid rate limits per key from
// on-chain payments, and serves a tiny control API. See docs/03-gateway.md.
package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/runonflux/cumulusvpn-gateway/internal/api"
	"github.com/runonflux/cumulusvpn-gateway/internal/config"
	"github.com/runonflux/cumulusvpn-gateway/internal/entitle"
	"github.com/runonflux/cumulusvpn-gateway/internal/fluxnode"
	"github.com/runonflux/cumulusvpn-gateway/internal/geoip"
	"github.com/runonflux/cumulusvpn-gateway/internal/limiter"
	"github.com/runonflux/cumulusvpn-gateway/internal/tlsrelay"
	"github.com/runonflux/cumulusvpn-gateway/internal/wg"
)

func main() {
	log.SetFlags(log.LstdFlags | log.LUTC)
	if err := run(); err != nil {
		log.Fatalf("gateway: fatal: %v", err)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	log.Printf("gateway %s starting: app=%q price=%.4f FLUX free=%dKB/s premium=%dMbit/s",
		api.Version, cfg.AppName, cfg.PriceFlux, cfg.FreeRateKBps, cfg.PremiumRateMbps)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// --- self-description from FluxOS node-info service (best effort) ---
	info := api.Info{}
	nodePublicIP := cfg.NodeHostIP
	if hi, err := fluxnode.GetHostInfo(ctx); err != nil {
		log.Printf("gateway: hostinfo unavailable (%v); continuing with env only", err)
	} else {
		info.Country = hi.Geo.Country
		info.Region = hi.Geo.Region
		// FluxOS hostinfo has no city field, only region (US state / province).
		info.City = hi.Geo.Region
		if hi.IP != "" {
			nodePublicIP = hi.IP
		}
	}

	// FluxOS hostinfo geo is empty on many datacenter nodes (observed fleet-wide:
	// country/region/city all blank), which breaks per-city grouping and the
	// dashboard's location labels. Fall back to a geoIP lookup of our OWN public
	// IP so /v1/info reports a real country/region/city. Best-effort: on failure
	// the locality just stays blank. Only fills fields hostinfo left empty.
	if info.Country == "" || info.Region == "" || info.City == "" {
		if g, err := geoip.Lookup(ctx, nodePublicIP); err != nil {
			log.Printf("gateway: geoip lookup failed (%v); locality left blank", err)
		} else {
			if info.Country == "" {
				info.Country = g.Country
			}
			if info.Region == "" {
				info.Region = g.Region
			}
			if info.City == "" {
				info.City = g.City
			}
			log.Printf("gateway: geoip → country=%q region=%q city=%q", info.Country, info.Region, info.City)
		}
	}

	// --- WireGuard userspace device + netstack ---
	// Load the server key ONCE and share it across the vanilla and obfuscated
	// devices. If we let each device load it independently and the key file is
	// unwritable, they would generate DIFFERENT random keys — silently breaking
	// the obfs transport, since clients pin the vanilla pubkey for both.
	serverKey, err := wg.LoadOrGenerateKey(cfg.KeyFile)
	if err != nil {
		return err
	}
	dev, err := wg.NewWithKey(config.WGListenPort, serverKey)
	if err != nil {
		return err
	}
	defer dev.Close()
	log.Printf("gateway: WG up on :%d server_pubkey=%s", config.WGListenPort, dev.PublicKey())

	// --- rate limiter ---
	lim := limiter.New(cfg.FreeRateKBps, cfg.PremiumRateMbps)

	// --- exit forwarder (the crux) ---
	fwd := wg.NewForwarder(dev, lim, cfg.EgressAllowPorts, cfg.GatewayFleetAllow)
	fwd.SetAllowPrivateEgress(cfg.AllowPrivateEgress)
	if err := fwd.Start(); err != nil {
		return err
	}
	log.Printf("gateway: forwarder started (allowlist=%v fleet_allow=%v)", cfg.EgressAllowPorts, cfg.GatewayFleetAllow)

	// --- obfuscated (AmneziaWG) listener: additive, env-gated (docs/15) ---
	// Same server identity as vanilla (one enrollment serves both) on the UDP
	// side of the API port, its own forwarder sharing the limiter. Off by
	// default; when off, nothing is advertised and the node behaves like 0.1.0.
	var obfsTransports []api.ExtraTransport
	if cfg.ObfsEnable {
		obfsDev, err := wg.NewObfuscatedWithKey(config.WGObfsPort, serverKey, wg.DefaultObfsParams)
		if err != nil {
			return err
		}
		defer obfsDev.Close()
		obfsFwd := wg.NewForwarder(obfsDev, lim, cfg.EgressAllowPorts, cfg.GatewayFleetAllow)
		obfsFwd.SetAllowPrivateEgress(cfg.AllowPrivateEgress)
		if err := obfsFwd.Start(); err != nil {
			return err
		}
		obfsTransports = append(obfsTransports, api.ExtraTransport{
			Device: obfsDev,
			Advertise: api.Transport{
				Type:   "awg",
				Port:   config.WGObfsPort,
				Params: wg.DefaultObfsParams.Map(),
			},
		})
		log.Printf("gateway: obfuscated (AmneziaWG) listener up on :%d/udp", config.WGObfsPort)
	}

	// --- WG-over-TLS "stealth" listener: additive, env-gated (docs/15) ---
	// A self-signed TLS relay in front of a WG device (looks like HTTPS, beats
	// UDP-blocking). Off by default. Two shapes:
	//
	//   CVPN_TLS_PREMIUM=0 (default) — the relay fronts the VANILLA device, so
	//     any existing enrollment works and the transport is open to everyone.
	//     This is the standard group, where wg-tls rides the free TCP side of
	//     51820 and costs nothing.
	//   CVPN_TLS_PREMIUM=1 — the relay fronts a DEDICATED device whose peer set
	//     holds only entitled keys, reserving the scarce 443 stealth tier for
	//     paying users. The relay bridges opaque WireGuard frames and can't read
	//     the peer key, so gating has to live in the device's peer set: a free
	//     user completes TLS but never the inner WG handshake. That device's UDP
	//     port is container-internal (never in a Flux spec's ports[]), so the
	//     relay is the only way in.
	if cfg.TLSEnable {
		cert, err := tlsrelay.SelfSignedCert(cfg.TLSSNI)
		if err != nil {
			return err
		}
		// Which device the relay bridges into, and how it's advertised.
		relayWGPort := config.WGListenPort
		params := map[string]string{"sni": cfg.TLSSNI}
		var tlsDev *wg.Device
		if cfg.TLSPremium {
			// Same server identity as the other devices (share the loaded key —
			// never re-load it, or an unwritable /data mints a second identity).
			tlsDev, err = wg.NewWithKey(config.WGTLSPremiumPort, serverKey)
			if err != nil {
				return err
			}
			defer tlsDev.Close()
			// Its own netstack forwarder (handlers are per-stack), sharing the
			// limiter so per-peer rate limits stay global across transports.
			tlsFwd := wg.NewForwarder(tlsDev, lim, cfg.EgressAllowPorts, cfg.GatewayFleetAllow)
			tlsFwd.SetAllowPrivateEgress(cfg.AllowPrivateEgress)
			if err := tlsFwd.Start(); err != nil {
				return err
			}
			relayWGPort = config.WGTLSPremiumPort
			// Advertised to everyone (/v1/info is unauthenticated) but tagged, so
			// clients skip it for free users instead of failing a handshake.
			params["tier"] = "premium"
		}
		relay := tlsrelay.NewRelay(relayWGPort, cert)
		// Bind on the TLS port directly. Do NOT route this through addr() —
		// CVPN_BIND is the control-API's dev override (a full host:port) and
		// reusing it verbatim here would put the relay and the API on the same
		// address, so one listener fails and shuts the whole gateway down.
		go func() {
			if err := relay.ListenAndServe(ctx, fmt.Sprintf(":%d", cfg.TLSPort)); err != nil {
				log.Printf("gateway: TLS relay error: %v", err)
				stop()
			}
		}()
		obfsTransports = append(obfsTransports, api.ExtraTransport{
			Device:      tlsDev, // nil unless premium-gated
			PremiumOnly: cfg.TLSPremium,
			Advertise: api.Transport{
				Type:   "wg-tls",
				Port:   cfg.TLSPort,
				Params: params,
			},
		})
		log.Printf("gateway: WG-over-TLS relay up on :%d/tcp (sni=%q premium=%v)",
			cfg.TLSPort, cfg.TLSSNI, cfg.TLSPremium)
	}

	// --- entitlement engine (chain scanner) ---
	chain := fluxnode.NewClient(cfg.NodeHostIP)
	ent := entitle.New(chainAdapter{chain}, cfg.PaymentAddress, cfg.PriceFlux)
	ent.OnChange(func(code string, premium bool) {
		log.Printf("gateway: entitlement flip code=%s premium=%v", code, premium)
	})
	// Resume from the last checkpoint so a redeploy — which happens on every
	// Flux app update — catches up incrementally instead of replaying the
	// whole payment address and serving free-only for minutes. Any problem
	// with the file just means a full scan, so it is never fatal.
	ent.SetStatePath(cfg.EntitleStateFile)
	if loaded, err := ent.Load(); err != nil {
		log.Printf("gateway: entitlement snapshot unusable (%v); full rescan", err)
	} else if loaded {
		log.Printf("gateway: entitlement snapshot restored from %s", cfg.EntitleStateFile)
	}
	if err := ent.Backfill(ctx); err != nil {
		// Non-fatal: start free-only, the poll loop backfills as it catches up.
		log.Printf("gateway: entitlement backfill failed (%v); starting free-only", err)
	}
	go ent.Run(ctx)

	// --- restore enrollments from the previous run ---
	// Runs after every transport device exists (so restored peers land on all of
	// them) and before the API accepts a request, so a client that reconnects the
	// instant we come up finds itself already enrolled.
	//
	// Without this, a restart silently de-registered every peer. The apps hide it
	// by re-enrolling on connect; a static .conf from the web client cannot, so
	// its user got a tunnel that reports connected and never handshakes. Restarts
	// are routine here — a Flux app update redeploys every container.
	recs, cacheClean := wg.LoadPeerCache(cfg.PeerCacheFile, cfg.MaxPeersTotal)
	if len(recs) > 0 {
		n := dev.RestorePeers(recs)
		// Mirror onto each additional transport that owns a device, exactly as
		// enroll does. Premium-gated devices are skipped here and reconciled by
		// syncTiers below, which resolves entitlement from chain — the single
		// source of truth, and the reason tier is not in the cache.
		for _, e := range obfsTransports {
			if e.Device == nil || e.PremiumOnly {
				continue
			}
			e.Device.RestorePeers(recs)
		}
		log.Printf("gateway: restored %d/%d peer(s) from %s", n, len(recs), cfg.PeerCacheFile)
	}
	// Persist from here on — but ONLY if the file was read completely. After a
	// partial read (unreadable file, a format this build doesn't know, more peers
	// than the ceiling) the first write would replace a file we couldn't read
	// with one derived from the little we recovered, turning a transient
	// permission error or a rollback into permanent data loss. Running read-only
	// for a boot just costs the old behaviour: peers re-enroll.
	if cacheClean {
		// Set AFTER restoring so the restore itself doesn't rewrite the file once
		// per peer. Only the vanilla device — the allocation authority whose table
		// is the superset — owns the cache.
		dev.SetPeerCache(cfg.PeerCacheFile)
	} else {
		log.Printf("gateway: WARNING: peer cache %s was not read cleanly; running WITHOUT persistence "+
			"this boot so the file is preserved — fix it and restart", cfg.PeerCacheFile)
	}

	// --- control API ---
	srv := api.New(cfg, dev, ent, lim, info, nodePublicIP, obfsTransports...)
	go srv.SampleLoad(ctx) // live throughput → real /v1/info load
	go srv.GC(ctx)         // bound the enroll-rate-limit + PoW-replay maps

	// Reconcile every enrolled peer's tier with chain state periodically.
	// entitle keys by payment code (hash of pubkey), the limiter keys by
	// pubkey, so we bridge here rather than in the OnChange callback. Runs after
	// the API exists because it also reconciles membership of any premium-gated
	// transport device (a peer that pays after enrolling must be added; an
	// expired one removed).
	go syncTiers(ctx, dev, ent, lim, srv)
	go reapIdlePeers(ctx, dev, ent, lim, srv, obfsTransports)
	httpSrv := &http.Server{
		Addr:              addr(config.APIPort),
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
	}
	go func() {
		log.Printf("gateway: control API on %s", httpSrv.Addr)
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("gateway: control API error: %v", err)
			stop()
		}
	}()

	// --- graceful shutdown ---
	<-ctx.Done()
	log.Printf("gateway: shutting down")
	shutCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = httpSrv.Shutdown(shutCtx)
	return nil
}

// syncTiers flips each enrolled peer's limiter to match chain entitlement, and
// reconciles membership of any premium-gated transport device. Runs on the same
// cadence as the block poll so a confirmed payment unlocks premium — both the
// rate limit and premium-only transports — within one cycle without any
// reconnect (docs/03-gateway.md). It also handles the reverse: entitlement
// expiry is eventless (Tier re-evaluates against the clock), so polling is the
// only way a lapsed subscription loses premium access.
func syncTiers(ctx context.Context, dev *wg.Device, ent *entitle.Engine, lim *limiter.Manager, srv *api.Server) {
	reconcile := func() {
		// dev is the vanilla device — the allocation authority every enroll
		// hits first, so its peer list is the superset of all transports.
		for _, pk := range dev.Peers() {
			premium, _ := ent.Tier(pk)
			lim.SetTier(pk, premium)
			srv.SyncPremiumPeers(pk, premium)
		}
	}
	// Reconcile once up front rather than waiting out the first tick: peers
	// restored from the cache have no tier yet, and a premium one would otherwise
	// be missing from the premium-gated device for the first interval.
	reconcile()

	t := time.NewTicker(15 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			reconcile()
		}
	}
}

// reapIdlePeers is the other half of peer persistence. While the table lived
// only in memory, a restart was an accidental garbage collector: caps like
// MaxPeersFree were effectively "concurrent peers since the last restart".
// Persisting the table removes that, so without eviction the caps would become
// LIFETIME caps — the node would keep advertising capacity while 503-ing every
// new free user, forever (docs/03-gateway.md "Peer management").
//
// Idleness is measured by HANDSHAKE, never by enrollment: a web-issued static
// .conf enrolls exactly once and then handshakes for as long as it is used, so
// an enroll-driven clock would evict active users. Premium keys are never
// reaped while entitled, plus a grace period after expiry so a lapsed
// subscriber who renews doesn't lose their address.
func reapIdlePeers(
	ctx context.Context,
	dev *wg.Device,
	ent *entitle.Engine,
	lim *limiter.Manager,
	srv *api.Server,
	extra []api.ExtraTransport,
) {
	const (
		sweepEvery   = time.Hour
		freeIdle     = 30 * 24 * time.Hour // docs/03: free peers after 30d idle
		premiumGrace = 35 * 24 * time.Hour // …premium after paid_until + 35d
	)
	t := time.NewTicker(sweepEvery)
	defer t.Stop()
	for {
		// Refresh stamps first so a peer that is actively handshaking is never a
		// candidate, then evict. Both are cheap relative to the hourly period.
		dev.TouchFromHandshakes()

		now := time.Now()
		for _, rec := range dev.PeerRecords() {
			premium, paidUntil := ent.Tier(rec.PubKey)
			if premium {
				continue
			}
			cutoff := freeIdle
			// A key that ever paid keeps its address through the longer grace,
			// measured from expiry rather than from last use.
			if !paidUntil.IsZero() {
				if now.Sub(paidUntil) < premiumGrace {
					continue
				}
				cutoff = premiumGrace
			}
			// A zero stamp means "never handshaked and never restored with one";
			// RestorePeers and enroll both stamp, so this is a fresh enroll that
			// has yet to connect — leave it alone until it ages normally.
			if rec.Seen.IsZero() || now.Sub(rec.Seen) < cutoff {
				continue
			}
			if err := dev.RemovePeer(rec.PubKey); err != nil {
				log.Printf("gateway: could not reap idle peer: %v", err)
				continue
			}
			for _, e := range extra {
				if e.Device == nil {
					continue
				}
				_ = e.Device.RemovePeer(rec.PubKey)
			}
			lim.Remove(rec.PubKey)
			srv.SyncPremiumPeers(rec.PubKey, false)
		}

		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

func addr(port int) string {
	if v := os.Getenv("CVPN_BIND"); v != "" {
		return v
	}
	return ":" + strconv.Itoa(port)
}

// chainAdapter bridges *fluxnode.Client to entitle.TxSource, translating the
// fluxnode transaction type into the entitle-local one.
type chainAdapter struct{ c *fluxnode.Client }

func (a chainAdapter) BlockCount(ctx context.Context) (int64, error) {
	return a.c.BlockCount(ctx)
}

func (a chainAdapter) AddressTxs(ctx context.Context, addr string, after int64) ([]entitle.Tx, error) {
	raw, err := a.c.AddressTxs(ctx, addr, after)
	if err != nil {
		return nil, err
	}
	out := make([]entitle.Tx, len(raw))
	for i, tx := range raw {
		out[i] = entitle.Tx{
			TxID:     tx.TxID,
			Height:   tx.Height,
			Time:     tx.Time,
			AmountTo: tx.AmountTo,
			Memos:    tx.Memos,
		}
	}
	return out, nil
}
