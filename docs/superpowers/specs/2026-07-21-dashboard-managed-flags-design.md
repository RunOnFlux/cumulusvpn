# Design — Dashboard-managed feature flags

**Date:** 2026-07-21
**Status:** Approved (design)

## Problem

Feature flags (`inAppUpgrade`, per platform) live in a static `flags.json` in the GitHub repo
and are fetched by the mobile app from `raw.githubusercontent.com`. Editing them means a manual
commit + push. We want them configurable from our internal dashboard instead.

## Approved decisions

1. **Scope:** just the current `inAppUpgrade` flag (per-platform android/ios booleans). Not a
   general registry yet.
2. **Storage/serving:** Cloudflare **KV**, read/written by the existing `cumulusvpn-dashboard`
   Worker. The mobile app reads a new endpoint (repointed — free, app not yet released).
3. **Auth:** a **password-gated `/admin`** area on the dashboard; single admin password held as a
   Worker secret. The public fleet monitor stays public.

## Architecture

```
Admin → /admin (password) → POST /api/flags → KV ← GET /api/flags ← mobile app (fail-closed OFF)
        dashboard.cumulusvpn.com (existing Worker + new KV binding)
```

- Only the **mobile app** consumes flags today (web/desktop don't). Single consumer.
- The KV value keeps the **exact JSON shape** as `flags.json`
  (`{ "inAppUpgrade": { "android": bool, "ios": bool } }` + an `updatedAt`), so the app's
  `resolveFlags`/`fetchFlags` and their tests are unchanged — only the URL changes.

## Components

### 1. KV
- Namespace bound to the dashboard Worker as `FLAGS_KV`. One key `flags` →
  `{ inAppUpgrade: { android, ios }, updatedAt }`.
- Worker fallback default when KV is empty/unreadable: **all OFF** (fail-safe).

### 2. Worker endpoints (`clients/dashboard/worker.js`, alongside `/api/fleet`)
- `GET /api/flags` — **public**. Returns current flags from KV (or the all-OFF default), short
  cache + `access-control-allow-origin: *`. This is what the app fetches.
- `POST /api/flags` — **authed**. Validates `Authorization: Bearer <token>` against `ADMIN_TOKEN`
  (constant-time SHA-256 digest compare), validates the body shape, writes KV, stamps
  `updatedAt` (ISO). Returns the new record.
- `POST /api/admin/verify` — **authed**. Returns `{ok:true}` 200 / 401 so the login screen can
  distinguish a wrong password before editing.
- Everything else falls through to `env.ASSETS.fetch` (unchanged), so `/admin` serves the static
  page and `/api/fleet` still works.

### 3. Auth
- Single admin password stored as Worker secret `ADMIN_TOKEN` (`wrangler secret put`).
- The `/admin` page prompts for it, keeps it in `sessionStorage`, sends it as a Bearer header on
  writes. The admin HTML is public (no secret in it); protection is that **writes require the
  token**. Constant-time compare via SHA-256 digests (fixed length, no length leak). No
  sessions/JWT (single-admin tool).

### 4. Admin UI — `clients/dashboard/public/admin.html` (→ `/admin`)
Brand-styled (CumulusVPN tokens, Inter from the dashboard's `/fonts`), vanilla JS:
- Login card: password → `POST /api/admin/verify` → on ok, store token, show editor.
- Editor card: `GET /api/flags` populates two toggles (`inAppUpgrade` · Android / iOS); **Save**
  → `POST /api/flags`; shows `updatedAt` + a success/error toast; 401 → back to login.
- **⚠️ Compliance banner** (always visible): "Enabling this turns on the in-app crypto purchase
  UI. Do NOT enable it for a build under or past App Store / Google Play review — that's a
  policy violation. Direct-APK / web / testing builds only."

### 5. Mobile app — the only code change
`clients/mobile/src/lib/flags.ts`: repoint `FLAGS_URL` from the `raw.githubusercontent.com`
`flags.json` URL to `https://dashboard.cumulusvpn.com/api/flags`; update the file's doc comment.
`resolveFlags`, fail-closed `fetchFlags`, and `flags.test.ts` unchanged (identical JSON shape).

### 6. `flags.json` disposition
Keep it in the repo as the **documented default / KV seed**; update its `_comment` to state that
live state is managed in the dashboard (KV) and served at `/api/flags`. Preserve the current
values (`android:true, ios:false`) so behavior doesn't silently change — the dashboard is now how
you flip them. One-time seed:
`wrangler kv key put --binding=FLAGS_KV flags "$(cat flags.json)"` (strip the `_comment`, or seed
the two-field object directly).

### 7. wrangler config
`clients/dashboard/wrangler.jsonc`: add the `FLAGS_KV` `kv_namespaces` binding (id filled after
`wrangler kv namespace create`) and a comment documenting the `ADMIN_TOKEN` secret.

## Provisioning (needs the user's CF/wrangler access — "not admin")
1. `wrangler kv namespace create FLAGS_KV` → put the returned id in `wrangler.jsonc`.
2. `wrangler secret put ADMIN_TOKEN --config clients/dashboard/wrangler.jsonc`.
3. `wrangler deploy --config clients/dashboard/wrangler.jsonc`.
4. Seed the key (step 6).
> If KV creation is blocked by the account role, that's the trigger to fall back to the
> GitHub-commit approach. Confirm early.

## Non-goals (YAGNI)
- Multi-user auth / roles; full change-history audit (only `updatedAt`).
- Generalizing beyond `inAppUpgrade`; web/desktop flag consumption.
- CORS preflight/OPTIONS (app GET is a simple request; admin POST is same-origin).

## Verification / acceptance
- `yarn workspace @cumulusvpn/mobile test` (or the mobile test runner) — `flags.test.ts` still
  green (shape unchanged).
- Worker read/write/auth structured as small pure helpers; reviewed. `wrangler dev` is broken in
  this env, so end-to-end is a post-deploy smoke test:
  - `GET /api/flags` → returns the seeded flags.
  - `POST /api/flags` with the right Bearer token → updates; `GET` reflects it.
  - `POST /api/flags` with a wrong/absent token → 401.
  - Mobile app (pointed at the new URL) reads the value; unreachable → fails closed to OFF.
- `/admin` renders, logs in, toggles + saves, shows the compliance banner.
