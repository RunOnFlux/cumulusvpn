// Command gateway is the CumulusVPN exit gateway: one static Go binary that
// runs a userspace WireGuard device (netstack, no NET_ADMIN), forwards flows
// to the internet as a VPN exit, enforces free/paid rate limits per key from
// on-chain payments, and serves a tiny control API. See docs/03-gateway.md.
package main

import (
	"context"
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
	dev, err := wg.New(config.WGListenPort, cfg.KeyFile)
	if err != nil {
		return err
	}
	defer dev.Close()
	log.Printf("gateway: WG up on :%d server_pubkey=%s", config.WGListenPort, dev.PublicKey())

	// --- rate limiter ---
	lim := limiter.New(cfg.FreeRateKBps, cfg.PremiumRateMbps)

	// --- exit forwarder (the crux) ---
	fwd := wg.NewForwarder(dev, lim, cfg.EgressAllowPorts, cfg.GatewayFleetAllow)
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
		obfsDev, err := wg.NewObfuscated(config.WGObfsPort, cfg.KeyFile, wg.DefaultObfsParams)
		if err != nil {
			return err
		}
		defer obfsDev.Close()
		obfsFwd := wg.NewForwarder(obfsDev, lim, cfg.EgressAllowPorts, cfg.GatewayFleetAllow)
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
	// A self-signed TLS relay in front of the vanilla WG device (looks like
	// HTTPS, beats UDP-blocking). No own device — it relays into the vanilla WG
	// listener, so an existing enrollment works. Off by default.
	if cfg.TLSEnable {
		cert, err := tlsrelay.SelfSignedCert(cfg.TLSSNI)
		if err != nil {
			return err
		}
		relay := tlsrelay.NewRelay(config.WGListenPort, cert)
		go func() {
			if err := relay.ListenAndServe(ctx, addr(cfg.TLSPort)); err != nil {
				log.Printf("gateway: TLS relay error: %v", err)
				stop()
			}
		}()
		obfsTransports = append(obfsTransports, api.ExtraTransport{
			Advertise: api.Transport{
				Type:   "wg-tls",
				Port:   cfg.TLSPort,
				Params: map[string]string{"sni": cfg.TLSSNI},
			},
		})
		log.Printf("gateway: WG-over-TLS relay up on :%d/tcp (sni=%q)", cfg.TLSPort, cfg.TLSSNI)
	}

	// --- entitlement engine (chain scanner) ---
	chain := fluxnode.NewClient(cfg.NodeHostIP)
	ent := entitle.New(chainAdapter{chain}, cfg.PaymentAddress, cfg.PriceFlux)
	ent.OnChange(func(code string, premium bool) {
		log.Printf("gateway: entitlement flip code=%s premium=%v", code, premium)
	})
	if err := ent.Backfill(ctx); err != nil {
		// Non-fatal: start free-only, the poll loop backfills as it catches up.
		log.Printf("gateway: entitlement backfill failed (%v); starting free-only", err)
	}
	go ent.Run(ctx)

	// Reconcile every enrolled peer's tier with chain state periodically.
	// entitle keys by payment code (hash of pubkey), the limiter keys by
	// pubkey, so we bridge here rather than in the OnChange callback.
	go syncTiers(ctx, dev, ent, lim)

	// --- control API ---
	srv := api.New(cfg, dev, ent, lim, info, nodePublicIP, obfsTransports...)
	go srv.SampleLoad(ctx) // live throughput → real /v1/info load
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

// syncTiers flips each enrolled peer's limiter to match chain entitlement.
// Runs on the same cadence as the block poll so a confirmed payment unlocks
// premium within one cycle without any reconnect (docs/03-gateway.md).
func syncTiers(ctx context.Context, dev *wg.Device, ent *entitle.Engine, lim *limiter.Manager) {
	t := time.NewTicker(15 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			for _, pk := range dev.Peers() {
				premium, _ := ent.Tier(pk)
				lim.SetTier(pk, premium)
			}
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
