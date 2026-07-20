# Landing migration: GitHub Pages → Cloudflare Workers (+ SEO & analytics)

**Date:** 2026-07-21
**Status:** Approved (design), pending implementation

## Goal

Move the marketing landing (`cumulusvpn.com`) off GitHub Pages onto a Cloudflare
Worker with static assets — the same platform and deploy pattern as the other two
web properties (`cumulusvpn` worker for vpn., `cumulusvpn-dashboard`) — and fix
the SEO and analytics gaps that motivated the move.

**Success criteria**

- `cumulusvpn.com` served by a `cumulusvpn-landing` Worker; GH Pages disabled.
- Our own `robots.txt` (with `Sitemap:` line) served — not Cloudflare's managed
  Content Signals file.
- `sitemap.xml`, real 404s, canonical + full OG/Twitter tags, favicons, JSON-LD
  live on the apex.
- `vpn.cumulusvpn.com` SPA is `noindex` and stops soft-404ing `/robots.txt`.
- Cloudflare Web Analytics (cookieless) collecting on landing **and** SPA.
- One deploy story: Cloudflare Git-connected Workers Builds for all three sites.

**Explicitly out of scope:** `dashboard.cumulusvpn.com` custom-domain fix (the
domain is NXDOMAIN today; separate task), any app (mobile/desktop) changes, any
store-filing changes, Next.js/framework adoption.

## Decisions made

| Decision | Choice |
|---|---|
| Topology | Separate Worker `cumulusvpn-landing` (dashboard pattern), **asset-only** — no `main`/worker.js until logic is actually needed |
| Deploy | Cloudflare Git-connected Workers Build, watch paths `clients/landing/**` |
| Analytics | CF Web Analytics beacons on landing + vpn. SPA using the **one existing zone site token** (`9e07c1b233a24fbda101b18947f1b1b3`, site_tag `cbb8bdb0e1ac40e3a7ddcfb8465bd04e`); segment by Host filter in the dashboard. (Recon found the site already exists with `auto_install: true` yet demonstrably injects nothing; Cloudflare no longer offers standalone subdomain sites, so one token for both is the intended model.) Apps untouched |
| SPA indexing | `noindex,follow` meta (landing is the canonical search surface); robots.txt stays permissive so the meta is crawlable |
| Cutover | DNS flip via Worker custom domain; GH Pages disabled only after live verification |

## Repo changes

New layout (`git mv clients/web/landing clients/landing`, then restructure):

```
clients/landing/
  wrangler.jsonc        # name: cumulusvpn-landing, assets-only
  public/
    index.html          # existing page + head upgrades (below)
    404.html            # tiny branded 404 (not_found_handling: "404-page")
    robots.txt          # allow all; Sitemap: https://cumulusvpn.com/sitemap.xml
    sitemap.xml         # single URL: https://cumulusvpn.com/
    og-image.png        # copied from clients/web/public/
    favicon.ico, favicon-16.png, favicon-32.png, apple-touch-icon.png
    fonts/, powered_by_light.svg, powered_by_dark.svg
```

**Landing `index.html` head additions**

- `<link rel="canonical" href="https://cumulusvpn.com/">`
- `og:url`, `og:image` (absolute URL), `og:image:width/height`, full
  `twitter:card` block (the page has OG title/description only today)
- favicon/apple-touch-icon links (none exist today)
- JSON-LD: `Organization` + `SoftwareApplication` with the $0.99/mo offer
- CF Web Analytics beacon `<script>` with the landing site token

**SPA (`clients/web/`)**

- `<meta name="robots" content="noindex,follow">` in `index.html`
- real `public/robots.txt` (permissive) so `/robots.txt` returns text/plain
  instead of the SPA shell
- CF beacon with the SPA's own site token

**Dashboard (`clients/dashboard/`)**

- `noindex,follow` meta in `public/index.html` only (no domain work).

**Removals / reference updates**

- Delete `.github/workflows/pages.yml` **in the same commit** as the move (the
  move's paths would otherwise trigger a doomed run).
- Sweep `clients/web/landing` references (at minimum `docs/09-build-plan.md`
  and `.github/workflows/README.md`).
- `store/privacy-policy.md`: one disclosure line — the **websites** use
  cookieless, aggregate Cloudflare Web Analytics (no cookies, no cross-site
  tracking, no user identification); the apps remain analytics-free, so store
  privacy filings are unaffected.

## Browser setup (Chrome), two phases

Git-connected Workers can't exist before their config is on `main`, so:

**Phase 1 — before any code (COMPLETED 2026-07-21)**

1. ~~Create WA sites~~ → **Done differently:** existing zone site reused; token
   `9e07c1b233a24fbda101b18947f1b1b3` for both landing and SPA (see Decisions).
2. Managed **Content Signals robots.txt**: the zone-Overview dropdown
   ("Manage your robots.txt") renders empty/unloadable in the dash. Empirical
   finding: origin robots.txt served with HTTP 200 passes through untouched
   (vpn.'s does); the signals file only appears where the origin 404s (GH
   Pages apex). → Defer: verify at cutover; only fight the toggle if our
   robots.txt actually gets swallowed.
3. Recon findings: apex + `www` are proxied CNAMEs → `runonflux.github.io`;
   `vpn.` is a Worker custom-domain record. The `www → apex` 301 is issued by
   the **GitHub Pages origin**, not Cloudflare → at cutover, create a zone
   **Single Redirect rule** (`www.cumulusvpn.com/* → https://cumulusvpn.com/$1`,
   301) and keep the `www` DNS record proxied. `cumulusvpn` worker build
   config captured: Git-connected to RunOnFlux/cumulusvpn (CF GitHub app
   already installed), root `/`, prod branch `main`, watch paths `*`.
4. GH Pages recorded for rollback: this repo, `build_type: workflow`, custom
   domain `cumulusvpn.com`, HTTPS enforced. **Neither the browser GitHub
   account nor local `gh` (stultusmundi, push-only) has repo admin — step 8
   (disable Pages) needs an org admin.**

**Phase 2 — after the code commit lands on `main`**

5. Cloudflare → Workers → import repo → `cumulusvpn-landing`: root `/`, no
   build command, deploy `npx wrangler deploy --config
   clients/landing/wrangler.jsonc`, watch paths `clients/landing/**`.
   Verify on the workers.dev preview URL.
6. Attach custom domain `cumulusvpn.com` (this is the cutover — rewrites apex
   DNS from GH Pages to the Worker; instant, reversible). Create the `www`
   Single Redirect rule (see Phase 1 findings) — the GH-origin 301 dies with
   Pages.
7. Verify live (see Testing). Include: our robots.txt actually served (see
   Phase 1 item 2 — revisit the managed-robots.txt toggle only if swallowed).
8. GitHub → disable Pages + remove its custom domain — only after 7 passes.
   **Requires a repo admin** (current accounts are push-only).

## Testing / verification

- `curl` assertions post-cutover: apex 200 with our title; `/robots.txt`
  text/plain with `Sitemap:` line; `/sitemap.xml` 200 XML; unknown path → 404
  with 404.html; canonical + og:image present; vpn. `/robots.txt` text/plain;
  vpn. HTML contains `noindex`.
- CF Web Analytics dashboards receiving events from both sites.
- Google Search Console (domain already DNS-verified): submit sitemap.
- `runonflux.github.io/cumulusvpn` currently 301s to the apex; that redirect
  disappears when Pages is disabled — acceptable (no inbound links rely on it).

## Rollback

Detach the Worker custom domain, re-enable GH Pages with the recorded custom
domain. DNS flips back the same way it flipped forward. The repo commit is
serving-independent — no code revert needed.
