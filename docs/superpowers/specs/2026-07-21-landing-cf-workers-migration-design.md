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
| Analytics | CF Web Analytics beacons on landing + vpn. SPA (one site token each); apps untouched |
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

**Phase 1 — before any code**

1. Cloudflare → Web Analytics: create sites for `cumulusvpn.com` and
   `vpn.cumulusvpn.com`; capture both beacon tokens (they get baked into HTML).
2. Cloudflare → zone: disable the managed **Content Signals robots.txt**
   override (currently replacing our robots.txt entirely).
3. Recon: how apex DNS points at GH Pages; whether the existing `www → apex`
   301 is a zone Redirect Rule (survives) or Pages-tied (needs replacing);
   the exact Workers Builds settings of the `cumulusvpn` worker to clone.
4. GitHub → Settings → Pages: record the current custom-domain config for
   rollback. No changes yet.

**Phase 2 — after the code commit lands on `main`**

5. Cloudflare → Workers → import repo → `cumulusvpn-landing`: root `/`, no
   build command, deploy `npx wrangler deploy --config
   clients/landing/wrangler.jsonc`, watch paths `clients/landing/**`.
   Verify on the workers.dev preview URL.
6. Attach custom domain `cumulusvpn.com` (this is the cutover — rewrites apex
   DNS from GH Pages to the Worker; instant, reversible). Handle `www` per
   step 3 findings.
7. Verify live (see Testing).
8. GitHub → disable Pages + remove its custom domain — only after 7 passes.

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
