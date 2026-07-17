# 08 — Open questions / decisions needed

1. **Brand name.** Sweeps done 2026-07-16; recommendation: **CumulusVPN — Powered by RunOnFlux**
   (pending user confirmation + formal trademark knockout).
   - **StratusVPN — leaning no-go:** Stratus Video runs an actual B2B VPN branded "StratusVPN"
     (stratusvideo.org/vpn); stratusvpn.com privately held since 2017; crowded STRATUS
     trademark field in cl. 9/42 (Stratus Technologies family). Stores vacant, but confusion +
     opposition risk is real.
   - **NimbusVPN — BLOCKED:** two live Play Store VPNs already trade as "NimbusVPN"/"Nimbus VPN"
     (tech.nimbusvpn.android with active brand site nimbusvpn.tech; com.secureaccess.nimbus.fast),
     plus a Chrome extension; nimbusvpn.com taken since 2016. Same failure mode as FluxVPN.
   - **CumulusVPN — CLEAN:** zero VPN apps with the name in either store; cumulusvpn.com/.app/
     getcumulusvpn.com all unregistered; github.com/cumulusvpn free; no indexed CUMULUS VPN
     trademark. Caveat: NVIDIA holds "CUMULUS" marks for networking software (Cumulus Linux,
     class 9) — adjacency arguable; run formal TESS/attorney knockout in cl. 9/38/42.
   - **cumulusvpn.com REGISTERED (2026-07-16) — name committed. Single domain only** (decided):
     no .io/.app; everything (site, directory.json, downloads) is served from cumulusvpn.com,
     itself deployed on Flux. Remaining: github.com/cumulusvpn org, @cumulusvpn socials, and the
     formal TESS/attorney knockout in cl. 9/38/42 (NVIDIA "Cumulus" adjacency) before store
     submission / trademark filing.
   - Reserves: ZelVPN (flagged by sweep as cleanest heritage option), Weber, Umbra.
     Ruled out: FluxVPN (1M+-download Play squatter). Home vpn.runonflux.com (single domain, no
     .io/.app); descriptor "Decentralized VPN on the Flux Network"; memo tag `CVPN1:` / env
     `CVPN_*`.

1a. **Enterprise + datacenter deployment (DECIDED).** All specs are enterprise v8 with
   `datacenter: true`: datacenter-only nodes (not homes), private image via `repoauth`, encrypted
   `enterprise` blob hiding the deployment. **Open tension to hold in view:** we promise "open
   source," yet hide the running image. Resolution stance — the gateway/client *source* is fully
   open and the build reproducible; what's private is only the *deployment* (which registry, which
   nodes, registry creds). That's deployment privacy + abuse reduction, not closed source, and not
   real security (clients reveal endpoints). Message it honestly. Still open: (a) confirm enough
   enterprise/datacenter nodes exist per target country (`generate.mjs --check`); (b) our owner
   ZelID on the enterprise whitelist; (c) stand up `registry.cumulusvpn.com`.

2. **First-party vs neutral.** DECIDED: first-party, our own Flux branding and clients. Unblocks
   `flux*` app-spec names (we whitelist our own prefix) and marketplace placement. The legal
   insulation question (which entity owns the payment address and answers abuse mail — RunOnFlux
   itself vs. a dedicated subsidiary) remains open for counsel; a subsidiary is still advisable.

3. **Operator opt-out flag in FluxOS.** Will the Flux team accept a small FluxOS feature letting
   node operators exclude exit-traffic apps? Strongly recommended before GA (see 06). Fallback:
   staticip/datacenter-only targeting.

4. **Price constant mechanics.** Confirm `SVPN_PRICE_FLUX` in app-spec env as the oracle-free
   canonical price (vs. embedding a rates-API with tolerance bands). Confirm 72 h dual-price grace.

5. **Control API transport.** Self-signed TLS with pinning vs. HTTP + WG-key-signed responses
   (03). Leaning: signed-response scheme for v1 (simpler, no cert plumbing), TLS later.

6. **Multi-device story for v1.** Per-device payment vs. shared key vs. wait for payment-key
   indirection (04). Leaning: document shared-key, ship indirection in v1.5.

7. **Free-tier knobs.** 100 KB/s confirmed? Daily GB cap on free? Stricter free port list?
   (Leaning: 100 KB/s + no cap + stricter ports.)

8. **Fiat rail timing.** Every surviving dVPN added fiat. Do we add IAP/Play Billing in v1 mobile
   or stay pure-FLUX for ideology + simplicity until traction? Leaning: pure FLUX at launch,
   fiat within 6 months.

9. **Jurisdiction/entity** for the payment address, app ownership, abuse desk. Needs counsel.

10. **Regional availability list** for store builds (exclude China/UAE/RU… where VPN apps are
    illegal) — needed for store submission (Apple 5.4).
