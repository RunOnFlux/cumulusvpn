# Design — Privacy & Support pages for cumulusvpn.com

**Date:** 2026-07-21
**Status:** Approved (design)
**Author:** Claude (pairing with the CumulusVPN team)

## Problem

The App Store and Google Play listings reference `https://cumulusvpn.com/privacy` and
`https://cumulusvpn.com/support`, but neither page exists. Both stores validate a **live,
publicly reachable privacy-policy URL** during review, and Apple additionally requires a live
**support URL**. This is a submission blocker for both stores. The privacy content already
exists as `store/privacy-policy.md`; there is no support content yet.

## Goal

Publish two brand-consistent, accessible static pages on the apex marketing site
(`cumulusvpn.com`) that resolve at `/privacy` and `/support`, clearing the store URL blockers,
and correct a known factual inaccuracy about transport encryption while doing so.

## Context / constraints

- **Apex site stack:** `clients/landing/` is a **framework-free static site** — a `public/`
  directory of hand-written HTML deployed via a Cloudflare *assets-only* Worker
  (`clients/landing/wrangler.jsonc`, `assets.directory = "public"`,
  `not_found_handling = "404-page"`). No build step, no React, no bundler.
- **Design system:** `public/index.html` carries a self-contained "Signed sky" design in an
  inline `<style>` block — Inter (`/fonts/inter-*.woff2`), tokens (`--cyan #0FB9AE/#34E4DA`,
  `--amber`, `--ink`, `--line`, …), light/dark via `@media (prefers-color-scheme)` **and**
  `:root[data-theme=...]` overrides, a sticky header, a columned footer, and a small theme-toggle
  script persisting to `localStorage['cumulusvpn-theme']`.
- **Clean URLs:** Cloudflare asset routing serves `public/privacy.html` at `/privacy` and
  `public/support.html` at `/support` (default `html_handling` drops the `.html` and adds a
  trailing-slash redirect). No Worker code or config change needed.
- **Reference pattern (user request):** the Zelcore and SSP sibling sites (`../zelcore-website`,
  `../ssp-website`, both Next.js) structure legal/support pages as: a dedicated route per legal
  doc, and a Support page = **categorized FAQ + support channels (docs / community / direct
  contact)**. We replicate that *content/UX pattern* in the landing's static-HTML stack.
- **Local tooling:** `wrangler dev` is broken in this environment; routing is verified by config
  reasoning + a plain static server render, not a full Worker run.

## Approved decisions

1. **Scope:** Privacy + Support only. No Terms of Service or Cookie policy this pass.
2. **Support channels:** Email (`info@cumulusvpn.com`) and GitHub (`RunOnFlux/cumulusvpn`) are
   live links; **Discord/Telegram and X/social are visibly-marked placeholders** with obvious
   in-code TODO markers so URLs can be filled in later.
3. **Privacy accuracy:** publish an accurate transport description (WireGuard-encrypted tunnel;
   control API integrity-signed with ed25519 over HTTP — **not** TLS) and **sync the store docs**
   (`store/play/data-safety.md` and any other `store/` file that claims "TLS") to match.

## Architecture

Four files touched/created under `clients/landing/public/`, plus store-doc syncs.

### New: `doc.css` (shared stylesheet for the two doc pages)
Keeps `index.html` untouched (its style block is hero/phone/tier-specific and irrelevant here).
Contains only what the doc pages need:
- `@font-face` Inter (400/500/600/700) from `/fonts/`.
- `:root` token vars + dark-mode + `:root[data-theme="light|dark"]` overrides — **copied
  verbatim** from `index.html` so the palette matches exactly.
- Base/reset, aurora `body::before`, `.wrap` container, focus-visible ring.
- Header (`header.top`, `.brand`, `.mark`, nav, `.pbf`, `.theme-btn`) — same markup/classes as
  `index.html` so the two pages share the site chrome.
- Footer (`footer`, `.cols`, `.col`, `.foot-bottom`, `.disclaimer`).
- **Prose layout** (`.doc`, `.doc h1/h2/h3`, `p`, `ul/li`, `a`, `.doc-meta`, `.contact`) for
  legal text: max-width ~72ch, generous line-height, cyan links.
- **Support extras**: `.faq` + `<details>/<summary>` accordion styling (chevron, hairline
  dividers, hover), `.channels` card grid (reuses the `.appcard`/`.trust` visual language), and a
  `.placeholder` tag style for the not-yet-live socials.

### New: `privacy.html`
- `<head>`: title "Privacy Policy — CumulusVPN", meta description, canonical
  `https://cumulusvpn.com/privacy`, favicons, `<link rel="stylesheet" href="/doc.css">`, and a
  tiny **inline pre-paint theme script** (reads `localStorage`, sets `data-theme` to avoid a
  flash — an improvement over index.html's end-of-body timing).
- `<body>`: shared header → `<main class="wrap doc">` with the full policy → shared footer →
  inline theme-toggle click handler (same logic as index.html).
- **Content:** all 14 sections of `store/privacy-policy.md` as semantic HTML (h1 title;
  `.doc-meta` "Last updated / Effective 16 July 2026"; h2 per section; h3 for 4.1–4.5; lists;
  `.contact` block for §14). Transport wording corrected per decision 3 (§4.5/§12 phrased as
  WireGuard tunnel + ed25519-signed control responses, no "TLS" claim).

### New: `support.html`
Same head/chrome/theme wiring as `privacy.html`, `<link href="/doc.css">`.
Body sections:
1. **Intro** — h1 "Support" + lede: "No account needed — most answers are here. Still stuck?
   Email us." (+ note that there's no login, so there's nothing to recover.)
2. **FAQ** — four `<section>`s, each an eyebrow heading + `<details>` accordions:
   - **Getting started:** what is CumulusVPN / do I need an account / how do I connect / is the
     free tier really free / which countries.
   - **Privacy & security:** do you keep logs / what is my key / what can a gateway operator see /
     what is multi-hop / is this like Tor.
   - **Premium & payment:** how do I upgrade / what is FLUX & how do I get it / how does my device
     unlock / can I prepay / do you take cards.
   - **Troubleshooting:** "no gateways/countries" / won't connect / slow speeds / the VPN
     permission prompt / how to fully remove myself.
   (Exact copy drafted in the "FAQ content" appendix below — no placeholders.)
3. **Support channels** — `.channels` grid of cards: Email (mailto, live), GitHub Issues (live),
   Community Discord/Telegram (placeholder), X/social (placeholder).

### Edit: `index.html`
Footer "Learn"/"Product" columns: repoint the existing "Privacy" link from `#trust` to `/privacy`
and add a "Support" → `/support` link. (Small, low-risk; no style changes.)

### Edit: `sitemap.xml`
Add `<url>` entries for `/privacy` and `/support`.

### Edit: store docs (accuracy sync)
`grep -rn "TLS" store/` and correct each claim that discovery/control-API traffic uses TLS.
Known: `store/play/data-safety.md` ("discovery/API use TLS" → "the VPN tunnel is
WireGuard-encrypted; the gateway control API is integrity-signed (ed25519) and served over HTTP").
Fix any others the grep surfaces; leave the WireGuard-tunnel "encrypted in transit" claim intact
(it is true).

## Non-goals (YAGNI)

- No Terms of Service / Cookie policy pages.
- No contact form or backend (static site — `mailto:` only).
- No framework, bundler, or build step.
- No rewrite of `index.html`'s existing inline styles.
- No new fonts/assets (reuse `/fonts/`, favicons already in `public/`).

## Verification / acceptance criteria

- `/privacy` renders the full, accurate policy; `/support` renders FAQ + channels; both match the
  landing brand in **light and dark**, are responsive at ≤900px, and have no horizontal scroll.
- All internal links resolve; email/GitHub links are live; social links are visibly tagged
  placeholders with in-code TODOs.
- No `store/` file still claims control-plane TLS; `data-safety.md` matches the privacy page.
- Clean-URL routing confirmed against `wrangler.jsonc` asset config (+ static-server render of the
  files). No Worker/config change required.
- HTML validates (no unclosed tags); theme toggle persists; `<details>` accordions work with no
  JS and are keyboard-accessible.

## Appendix — FAQ content (final copy)

**Getting started**
- *What is CumulusVPN?* A decentralized WireGuard VPN that runs on the Flux cloud. One tap routes
  your traffic through datacenter nodes worldwide. No account, no logs.
- *Do I need an account?* No. On first launch the app generates a WireGuard key on your device —
  that key is your only identity. No email, password, or phone number, ever.
- *How do I connect?* Open the app, pick a country, tap connect. On the first connection your
  phone shows a standard OS VPN-permission prompt — approve it once.
- *Is the free tier really free?* Yes, forever. It's capped at 100 KB/s (fine for browsing and
  chat), with no card and no trial.
- *Which countries can I use?* Every gateway in the fleet — 30+ countries at launch — and the list
  updates live from the network.

**Privacy & security**
- *Do you keep logs?* No activity logs. Gateways hold minimal routing state in RAM only, erased on
  disconnect or restart. Your browsing, DNS queries, and traffic are never recorded.
- *What is my "key"?* A WireGuard keypair generated on your device. The private key never leaves
  your phone; only the public key is shared, to route your tunnel. It's a pseudonym, not tied to
  your identity.
- *What can a gateway operator see?* Like any VPN exit, real-time encrypted flow metadata — but no
  log we create, and never your traffic contents. Turn on multi-hop so no single server sees both
  who you are and where you're going.
- *What is multi-hop?* It routes your traffic through two gateways, so no single server sees both
  your IP and your destination. It's slower — the app tells you how much — and it's off by
  default.
- *Is this like Tor?* No. CumulusVPN protects you from local-network snooping, ISP logging, and
  geo-restrictions, but it is not anonymity software like Tor. We say so plainly.

**Premium & payment**
- *How do I upgrade to premium?* Premium (full speed) is purchased on the web at
  `vpn.cumulusvpn.com` with FLUX from your own wallet. The mobile app has no purchase screen —
  your device unlocks on its own about a minute after payment confirms.
- *What is FLUX and how do I get it?* FLUX is the cryptocurrency of the Flux network. Buy it on an
  exchange and hold it in a wallet such as Zelcore or SSP, then pay from there.
- *How does my device unlock?* Your entitlement is computed from the public blockchain and keyed
  to your public key, so every gateway flips your key to full speed within ~1 minute — on all
  servers at once, for 30 days.
- *Can I prepay several months?* Yes. Send a multiple of the monthly amount and the extra months
  stack (up to 24).
- *Do you take credit cards?* No. Payment is FLUX from your own wallet, on the web — no card, no
  billing account, nothing stored about you.

**Troubleshooting**
- *The app shows "no gateways" or no countries.* Your device probably has no working internet, or
  a captive portal (hotel/airport Wi-Fi) is blocking the gateway probe. Reconnect and reopen the
  app — discovery retries automatically.
- *It won't connect.* Approve the OS VPN-permission prompt on the first connect. If another VPN is
  already active, disconnect it first, then try again — or pick a different country.
- *Speeds are slow.* The free tier is capped at 100 KB/s server-side. Upgrade to premium for full
  speed.
- *What is the VPN permission prompt?* Android and iOS require your explicit consent before any app
  can create a VPN tunnel. It's the operating system asking, once — approve it to connect.
- *How do I fully remove myself?* Disconnect, then regenerate or delete your key in the app's
  settings. That severs the pseudonymous link; gateway state is RAM-only and already clears when
  you disconnect.

**Support channels**
- **Email** — `info@cumulusvpn.com` (support and privacy/data requests).
- **GitHub** — `github.com/RunOnFlux/cumulusvpn` — open an issue for bugs or feature requests.
- **Community** — Discord / Telegram *(placeholder — URL TBD)*.
- **Social** — X / other *(placeholder — URL TBD)*.
