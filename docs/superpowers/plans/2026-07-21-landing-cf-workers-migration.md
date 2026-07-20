# Landing → Cloudflare Workers Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the marketing landing off GitHub Pages onto an asset-only Cloudflare Worker (`clients/landing/`), and ship the SEO + analytics upgrades that motivated the move.

**Architecture:** The landing becomes `clients/landing/public/` served by an asset-only Worker (`cumulusvpn-landing`), mirroring `clients/dashboard/`. The SPA (`clients/web/`) gets `noindex`, a real robots.txt, and the analytics beacon. No build step for the landing — it stays a self-contained static page.

**Tech Stack:** Cloudflare Workers static assets (wrangler v4, JSONC config), plain HTML/CSS, Cloudflare Web Analytics beacon.

**Spec:** `docs/superpowers/specs/2026-07-21-landing-cf-workers-migration-design.md` (read it for the why; Phase-1 recon results are recorded there).

## Global Constraints

- Worker name: `cumulusvpn-landing`; compatibility_date `2026-07-17` (matches siblings).
- Web Analytics token (both sites, one token — see spec): `9e07c1b233a24fbda101b18947f1b1b3`.
- The `clients/web/landing` → `clients/landing` move and the `.github/workflows/pages.yml` deletion MUST be in the SAME commit (the move's paths would otherwise trigger a doomed Pages run).
- Do NOT touch `store/app-store/**` or `store/play/**` (store filings describe the apps; apps get no analytics). Only `store/privacy-policy.md` gets one disclosure paragraph.
- Canonical URL is `https://cumulusvpn.com/` (with trailing slash) everywhere it appears.
- All work is committed directly on `main` (repo convention), commits are NOT pushed until the final task.
- Run wrangler via `npx -y wrangler@4`. Local dev server port for verification: `8790`.

---

### Task 1: Move the landing to `clients/landing/` with an asset-only Worker config

**Files:**
- Move: `clients/web/landing/index.html` → `clients/landing/public/index.html`
- Move: `clients/web/landing/fonts/*` → `clients/landing/public/fonts/*`
- Move: `clients/web/landing/powered_by_light.svg`, `powered_by_dark.svg` → `clients/landing/public/`
- Create: `clients/landing/wrangler.jsonc`
- Delete: `.github/workflows/pages.yml`

**Interfaces:**
- Produces: `clients/landing/public/` is the Worker's asset root; every later landing task edits files under it. `npx -y wrangler@4 dev --config clients/landing/wrangler.jsonc --port 8790` serves it locally.

- [ ] **Step 1: Move the files with git mv**

```bash
cd /Volumes/MAC_EXTERNAL/repos/cumulusvpn
mkdir -p clients/landing/public
git mv clients/web/landing/index.html clients/landing/public/index.html
git mv clients/web/landing/fonts clients/landing/public/fonts
git mv clients/web/landing/powered_by_light.svg clients/landing/public/powered_by_light.svg
git mv clients/web/landing/powered_by_dark.svg clients/landing/public/powered_by_dark.svg
rmdir clients/web/landing 2>/dev/null || true
```

- [ ] **Step 2: Create `clients/landing/wrangler.jsonc`**

```jsonc
// Cloudflare Worker for cumulusvpn.com — the static marketing landing page.
// Asset-only (no Worker script): Cloudflare serves ./public directly.
//
// This is a SEPARATE Worker from the main site (cumulusvpn) and the dashboard
// (cumulusvpn-dashboard). Git-connected build settings (dashboard):
//   Root directory:  /
//   Build command:   (none — the page is static)
//   Deploy command:  npx wrangler deploy --config clients/landing/wrangler.jsonc
//   Watch paths:     clients/landing/**
// Custom domain cumulusvpn.com is attached in the Worker's settings; www is a
// zone-level Single Redirect rule (www.cumulusvpn.com/* → apex, 301).
{
  "name": "cumulusvpn-landing",
  "compatibility_date": "2026-07-17",
  "assets": {
    "directory": "public",
    // Real 404s for unknown paths: serve public/404.html with status 404.
    "not_found_handling": "404-page"
  }
}
```

- [ ] **Step 3: Delete the GitHub Pages workflow**

```bash
git rm .github/workflows/pages.yml
```

- [ ] **Step 4: Verify no stale path references remain**

Run: `grep -rn "web/landing" --exclude-dir=node_modules --exclude-dir=.git . | grep -v superpowers | grep -v CODEBASE-FINDINGS`
Expected: no output (CODEBASE-FINDINGS.md is a historical analysis doc — prose mention stays).

- [ ] **Step 5: Verify the Worker serves the page locally**

```bash
npx -y wrangler@4 dev --config clients/landing/wrangler.jsonc --port 8790 &
sleep 8
curl -s http://localhost:8790/ | grep -c "<title>CumulusVPN — Decentralized VPN on Flux Cloud</title>"
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8790/fonts/inter-400.woff2
kill %1
```

Expected: `1` (title found) and `200` (font served).

- [ ] **Step 6: Commit (move + workflow deletion together — REQUIRED atomicity)**

```bash
git add clients/landing .github/workflows
git commit -m "refactor(landing): move to clients/landing as asset-only CF Worker; drop GH Pages workflow"
```

---

### Task 2: SEO head — canonical, og:url/og:image, Twitter card, favicons

**Files:**
- Modify: `clients/landing/public/index.html` (head, after the `og:type` meta)
- Create (copies from `clients/web/public/`): `clients/landing/public/og-image.png`, `favicon.ico`, `favicon-16.png`, `favicon-32.png`, `apple-touch-icon.png`, `icon-512.png`

**Interfaces:**
- Consumes: Task 1's layout.
- Produces: `https://cumulusvpn.com/og-image.png` and `/icon-512.png` URLs that Task 3's sitemap/robots and Task 4's JSON-LD rely on.

- [ ] **Step 1: Copy the image assets (copies, not moves — the SPA keeps its own)**

```bash
cp clients/web/public/og-image.png clients/web/public/favicon.ico \
   clients/web/public/favicon-16.png clients/web/public/favicon-32.png \
   clients/web/public/apple-touch-icon.png clients/web/public/icon-512.png \
   clients/landing/public/
```

- [ ] **Step 2: Add the head tags**

In `clients/landing/public/index.html`, replace:

```html
<meta property="og:type" content="website" />
```

with:

```html
<meta property="og:type" content="website" />
<meta property="og:url" content="https://cumulusvpn.com/" />
<meta property="og:site_name" content="CumulusVPN" />
<meta property="og:image" content="https://cumulusvpn.com/og-image.png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="CumulusVPN — Private internet, no account, no logs." />
<meta name="twitter:description" content="Decentralized VPN on Flux Cloud. Powered by RunOnFlux. Free at 100 KB/s, full speed for $0.99/month in FLUX." />
<meta name="twitter:image" content="https://cumulusvpn.com/og-image.png" />
<link rel="canonical" href="https://cumulusvpn.com/" />
<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48" />
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png" />
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
```

- [ ] **Step 3: Verify**

```bash
grep -c 'rel="canonical" href="https://cumulusvpn.com/"' clients/landing/public/index.html
grep -c 'name="twitter:card"' clients/landing/public/index.html
ls clients/landing/public/og-image.png clients/landing/public/favicon.ico >/dev/null && echo assets-ok
```

Expected: `1`, `1`, `assets-ok`.

- [ ] **Step 4: Commit**

```bash
git add clients/landing/public
git commit -m "feat(landing): canonical + full OG/Twitter card + favicons"
```

---

### Task 3: robots.txt, sitemap.xml, branded 404

**Files:**
- Create: `clients/landing/public/robots.txt`
- Create: `clients/landing/public/sitemap.xml`
- Create: `clients/landing/public/404.html`

**Interfaces:**
- Consumes: Task 1's `not_found_handling: "404-page"` config (already committed).
- Produces: live URLs `/robots.txt`, `/sitemap.xml` used in Phase-2 verification and GSC sitemap submission.

- [ ] **Step 1: Create `clients/landing/public/robots.txt`**

```
User-agent: *
Allow: /

Sitemap: https://cumulusvpn.com/sitemap.xml
```

- [ ] **Step 2: Create `clients/landing/public/sitemap.xml`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://cumulusvpn.com/</loc>
  </url>
</urlset>
```

- [ ] **Step 3: Create `clients/landing/public/404.html`** (matches the landing's palette/typeface; self-contained)

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Page not found — CumulusVPN</title>
<style>
  @font-face { font-family:"Inter"; font-style:normal; font-weight:600; font-display:swap; src:url("/fonts/inter-600.woff2") format("woff2"); }
  :root { --bg:#F5F8FB; --ink:#0C1420; --ink-2:#46586B; --cyan:#0FB9AE; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#070B11; --ink:#EAF1F8; --ink-2:#A6B6C6; --cyan:#34E4DA; }
  }
  html,body { height:100%; margin:0; }
  body { display:grid; place-items:center; background:var(--bg); color:var(--ink);
         font-family:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  main { text-align:center; padding:24px; }
  h1 { font-weight:600; letter-spacing:-.02em; margin:0 0 8px; }
  p { color:var(--ink-2); margin:0 0 20px; }
  a { color:var(--cyan); text-decoration:none; font-weight:600; }
  a:hover { text-decoration:underline; }
</style>
</head>
<body>
<main>
  <h1>404 — this cloud drifted away</h1>
  <p>The page you're looking for doesn't exist.</p>
  <a href="/">Back to CumulusVPN</a>
</main>
</body>
</html>
```

- [ ] **Step 4: Verify routing behavior locally**

```bash
npx -y wrangler@4 dev --config clients/landing/wrangler.jsonc --port 8790 &
sleep 8
curl -s -o /dev/null -w "robots %{http_code} %{content_type}\n" http://localhost:8790/robots.txt
curl -s -o /dev/null -w "sitemap %{http_code} %{content_type}\n" http://localhost:8790/sitemap.xml
curl -s -o /dev/null -w "missing %{http_code}\n" http://localhost:8790/this-does-not-exist
curl -s http://localhost:8790/this-does-not-exist | grep -c "cloud drifted away"
kill %1
```

Expected: `robots 200 text/plain...`, `sitemap 200 application/xml` (or text/xml), `missing 404`, `1`.

- [ ] **Step 5: Commit**

```bash
git add clients/landing/public
git commit -m "feat(landing): real robots.txt + sitemap.xml + branded 404"
```

---

### Task 4: JSON-LD structured data + Web Analytics beacon (landing)

**Files:**
- Modify: `clients/landing/public/index.html` (insert immediately before the single `</head>`)

**Interfaces:**
- Consumes: Task 2's `/og-image.png` and `/icon-512.png`; the Global-Constraints beacon token.

- [ ] **Step 1: Insert JSON-LD + beacon before `</head>`**

In `clients/landing/public/index.html`, replace the single `</head>` with:

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "name": "CumulusVPN",
      "url": "https://cumulusvpn.com/",
      "logo": "https://cumulusvpn.com/icon-512.png"
    },
    {
      "@type": "SoftwareApplication",
      "name": "CumulusVPN",
      "url": "https://cumulusvpn.com/",
      "applicationCategory": "SecurityApplication",
      "operatingSystem": "Android, iOS, Windows, macOS, Linux",
      "offers": [
        { "@type": "Offer", "price": "0", "priceCurrency": "USD", "description": "Free forever at 100 KB/s. No account, no email." },
        { "@type": "Offer", "price": "0.99", "priceCurrency": "USD", "description": "Full speed, per month, paid in FLUX from your own wallet." }
      ]
    }
  ]
}
</script>
<!-- Cloudflare Web Analytics: cookieless, aggregate; disclosed in store/privacy-policy.md.
     No SRI on purpose: beacon.min.js is unversioned and CF-updated, so an integrity hash
     would break it on their next deploy — and CF already proxies this site's every byte. -->
<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "9e07c1b233a24fbda101b18947f1b1b3"}'></script>
</head>
```

- [ ] **Step 2: Verify the JSON-LD parses and the beacon is present**

```bash
python3 -c "
import re,json
html=open('clients/landing/public/index.html').read()
block=re.search(r'<script type=\"application/ld\+json\">(.*?)</script>', html, re.S).group(1)
json.loads(block); print('jsonld-ok')"
grep -c 'data-cf-beacon' clients/landing/public/index.html
```

Expected: `jsonld-ok`, `1`.

- [ ] **Step 3: Commit**

```bash
git add clients/landing/public/index.html
git commit -m "feat(landing): JSON-LD (Organization + SoftwareApplication) and CF Web Analytics beacon"
```

---

### Task 5: SPA — noindex, real robots.txt, beacon

**Files:**
- Modify: `clients/web/index.html`
- Create: `clients/web/public/robots.txt`

**Interfaces:**
- Consumes: Global-Constraints beacon token (same one as the landing — one zone site, segmented by Host filter).

- [ ] **Step 1: Add `noindex` meta**

In `clients/web/index.html`, replace:

```html
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
```

with:

```html
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex, follow" />
```

(Rationale: the landing is the canonical search surface; `noindex` requires the page to stay crawlable, which is why robots.txt below is permissive.)

- [ ] **Step 2: Add the beacon before `</head>`**

In `clients/web/index.html`, replace:

```html
    </script>
  </head>
```

with:

```html
    </script>
    <!-- Cloudflare Web Analytics: cookieless, aggregate; disclosed in store/privacy-policy.md.
         No SRI on purpose: beacon.min.js is unversioned and CF-updated, so an integrity
         hash would break it on their next deploy — and CF already proxies this site. -->
    <script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "9e07c1b233a24fbda101b18947f1b1b3"}'></script>
  </head>
```

- [ ] **Step 3: Create `clients/web/public/robots.txt`** (stops the SPA soft-404ing `/robots.txt` as HTML; permissive so the `noindex` meta is reachable)

```
User-agent: *
Allow: /
```

- [ ] **Step 4: Run the web workspace tests and build**

Run: `yarn workspace @cumulusvpn/web run test && yarn build:web`
Expected: vitest suites PASS; vite build completes; `clients/web/dist/robots.txt` exists (verify: `ls clients/web/dist/robots.txt`).

- [ ] **Step 5: Commit**

```bash
git add clients/web/index.html clients/web/public/robots.txt
git commit -m "feat(web): noindex SPA (landing is canonical), real robots.txt, CF analytics beacon"
```

---

### Task 6: Dashboard — noindex

**Files:**
- Modify: `clients/dashboard/public/index.html`

- [ ] **Step 1: Add `noindex` meta**

In `clients/dashboard/public/index.html`, replace:

```html
<meta name="viewport" content="width=device-width, initial-scale=1" />
```

with:

```html
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, follow" />
```

- [ ] **Step 2: Verify + commit**

Run: `grep -c 'name="robots" content="noindex, follow"' clients/dashboard/public/index.html`
Expected: `1`

```bash
git add clients/dashboard/public/index.html
git commit -m "chore(dashboard): noindex the fleet monitor"
```

---

### Task 7: Privacy policy — website analytics disclosure

**Files:**
- Modify: `store/privacy-policy.md` (§3, after the "no ad networks" paragraph)

- [ ] **Step 1: Insert the disclosure**

In `store/privacy-policy.md`, replace:

```markdown
We do not use third-party advertising networks, and we do not use analytics products that
build a profile of you (such as ad-tech SDKs). The apps ship without behavioural trackers.
```

with:

```markdown
We do not use third-party advertising networks, and we do not use analytics products that
build a profile of you (such as ad-tech SDKs). The apps ship without behavioural trackers.

Our **websites** (`cumulusvpn.com` and `vpn.cumulusvpn.com`) use Cloudflare Web Analytics,
a cookieless, aggregate measurement service: it sets no cookies, stores nothing on your
device, and cannot identify or profile individual visitors. It tells us page counts, not
people. The apps contain no analytics of any kind.
```

- [ ] **Step 2: Verify formatting + commit**

Run: `npx prettier --check store/privacy-policy.md` (the root `format:check` script does not cover `store/`)
Expected: no formatting complaints (if prettier flags line width, wrap to match the file's existing ~95-char prose width).

```bash
git add store/privacy-policy.md
git commit -m "docs(privacy): disclose cookieless Cloudflare Web Analytics on the websites"
```

---

### Task 8: Full repo check, then push

- [ ] **Step 1: Run the monorepo check**

Run: `yarn check`
Expected: format, lint, typecheck, and tests all pass across workspaces. (The landing is not a workspace — static files only — so it is exercised by Tasks 1–4's wrangler/curl checks instead.)

- [ ] **Step 2: Push to main** (required for Phase 2 — the Cloudflare Git-connected build reads `main`; this also auto-deploys the SPA changes through the existing `cumulusvpn` worker build)

```bash
git push origin main
```

Expected: push succeeds; Cloudflare kicks a build of the `cumulusvpn` worker (watch paths `*`).

---

## Phase 2 — cutover (browser work, performed by the MAIN session, not a subagent)

After Task 8 lands on `main` (spec: "Browser setup, two phases" — Phase 1 already done 2026-07-21):

1. Cloudflare dash → Workers & Pages → Create → import `RunOnFlux/cumulusvpn` → name `cumulusvpn-landing`; root `/`, build command empty, deploy command `npx wrangler deploy --config clients/landing/wrangler.jsonc`; after creation set Build watch paths to `clients/landing/**`. First build deploys; verify on the workers.dev URL.
2. Worker → Settings → Domains & Routes → add custom domain `cumulusvpn.com` (this rewrites the apex DNS record — the actual cutover).
3. Zone → Rules → create Single Redirect: `www.cumulusvpn.com/*` → `https://cumulusvpn.com/${1}`, 301, preserve query string; keep the `www` DNS record proxied.
4. Verify live: apex title; `/robots.txt` is ours (text/plain with `Sitemap:` line — see spec's managed-robots.txt deferral note); `/sitemap.xml` 200; unknown path → 404 page; og-image loads; beacon request fires (browser network tab); `www` 301s.
5. GitHub → repo Settings → Pages → remove custom domain + disable Pages. **Needs repo admin** (recorded rollback state: workflow-type Pages, cname `cumulusvpn.com`, HTTPS enforced).
6. Google Search Console (domain property already DNS-verified): submit `https://cumulusvpn.com/sitemap.xml`.

Rollback: detach the Worker custom domain, re-enable Pages with custom domain `cumulusvpn.com` — DNS flips back. No code revert needed.
