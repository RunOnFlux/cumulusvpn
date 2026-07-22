# Google Play Submission Readiness Checklist — CumulusVPN (Android)

> Annotated against the **actual repo state** as of 2026-07-21, not a generic template.
> Sources: current Play policies (VpnService, Payments, FGS types, target-API, 16 KB,
> Data safety, Play App Signing, new-account testing) + the repo's own `store/` package.
>
> **Legend:** ✅ done · ⚠️ present but needs a decision/fix · ❌ blocker · ❓ can't verify from
> repo — confirm before submitting · ⬜ not started

---

## 0. Blockers first

1. ✅ **In-app crypto purchase UI is OFF on Android** (blocker cleared, verified 2026-07-22).
   Live flag `inAppUpgrade.android = false` in the dashboard KV
   (`https://dashboard.cumulusvpn.com/api/flags` → `{"android":false,"ios":false}`,
   `updatedAt 2026-07-22T08:00:06Z`), so `UpgradeScreen` renders the store-compliant "manage
   on the web" copy — **no** QR / "Open in wallet" deep-link / pay-to address. The listing's
   **"In-app purchases: No"** and the `data-safety.md` "no financial info" answers are now
   truthful, matching `billing-stance.md`. The repo seed `flags.json` was aligned to
   `android:false` so a re-seed can't reintroduce it. ⚠️ **This is a runtime remote flag, not a
   build-time lock** — the only thing holding the store build compliant is the KV value staying
   `false` (see the guardrail below).
2. ⚠️ **Guardrail — do NOT flip the crypto flag on after approval.** The flag is fetched at
   launch from the dashboard KV and takes effect with no rebuild (≤60 s edge cache). Remotely
   enabling a payment path post-review is itself a policy violation (behavior change after
   review) on Play *and* Apple. Keep OFF **permanently** for store builds; use crypto only for
   direct-APK / other-store distribution. A build-time hard-off gate for store variants (so a
   store binary *cannot* be remotely flipped) was **deferred** — "for now" compliance rests on
   the KV value. Revisit that gate before scaling distribution.
3. ✅ **Phone screenshots done** (blocker cleared). 5 real Pixel-6-Pro captures at 1080×2160
   (2:1) in `store/assets/screenshots/android/` (01-connect…05-brand), raws in `raw/android/`.
   Meets Play's ≥2-phone requirement. ⬜ Tablet (7"/10") screenshots still optional — add to
   avoid the "not optimized for tablets" flag. ⚠️ Note: frame 03 shows the tier line — with crypto
   now OFF the app won't render the pay UI; still, never add a screenshot depicting it (guardrail #2).
4. ✅ **Privacy Policy page LIVE** (blocker cleared, verified 2026-07-21).
   <https://cumulusvpn.com/privacy> serves the full policy (+ <https://cumulusvpn.com/support>).
   Play requires a live, app-specific URL in the listing **and** reachable in-app. → Paste
   `cumulusvpn.com/privacy` into the Play Console Privacy policy field at submission, and make sure
   the app links to it in-app (see note below).

---

## 1. VpnService policy & positioning

- [x] ✅ VpnService declaration text ready (`store/play/vpnservice-declaration.md`); core
  functionality = VPN; no traffic monetization.
- [ ] ⬜ **Demo video ≤ 90s** showing the app open + VPN connecting — **required** by the
  VpnService declaration form. Not yet produced.
- [ ] ⚠️ **"VPN not core functionality" is the top dVPN rejection.** A crypto-pay UI +
  "decentralized/Flux" framing risks Google reading this as a crypto app with a VPN feature.
  Mitigate: VPN-first listing (already good), **no wallet/exchange functionality** in-app
  (only external deep-link — another reason to ship crypto OFF, blocker #1).
- [ ] ⬜ If the decentralized network **pays node/relay rewards** or relays peer traffic,
  disclose it (VpnService bans undisclosed traffic manipulation/bandwidth resale).

## 2. Manifest / build config — current state

- [x] ✅ `applicationId com.cumulusvpn.app`; `targetSdk 36`, `minSdk 24`, `compileSdk 36` —
  **meets/exceeds** Play's requirement (≥ 35 now, 36 by Aug 31 2026). Already at 36. 👍
- [x] ✅ Permissions: INTERNET, BIND_VPN_SERVICE, FOREGROUND_SERVICE,
  FOREGROUND_SERVICE_SPECIAL_USE, POST_NOTIFICATIONS. `allowBackup=false`.
- [ ] ⚠️ **FGS type: `specialUse` vs `systemExempted`.** `GoBackend$VpnService` declares
  `foregroundServiceType="specialUse"` (+ subtype property). Android docs list
  **`systemExempted`** as the type for configured VPN apps, and Play reviews `specialUse` in
  Console. Either can pass, but be ready to justify `specialUse` or switch to `systemExempted`
  (+ `FOREGROUND_SERVICE_SYSTEM_EXEMPTED` permission). → decide before the Console FGS
  declaration.
- [ ] ⚠️ **Multi-hop runs as a plain, non-foreground VpnService with no notification.**
  Verified: `CumulusMultihopVpnService` never calls `startForeground` (so **no** Android-14
  FGS-type crash — good). But a multi-hop tunnel then has **no persistent VPN notification and
  is killable under memory pressure** (`START_NOT_STICKY`). This misses the VpnService
  best-practice the repo's own `vpnservice-declaration.md` lists ("runs a foreground service
  with an ongoing notification while connected") — single-hop (GoBackend) posts one; multi-hop
  does not. → Make multi-hop a foreground service (same FGS type + notification) for
  reliability and policy parity.
- [x] ✅ `network_security_config` cleartext (needed — control API is HTTP to node IPs, ed25519
  signature-verified). Allowed by Play.
- [x] ✅ **`bundleRelease` produces a valid `.aab`** — built and verified locally 2026-07-22:
  `android/app/build/outputs/bundle/release/app-release.aab` (66 MB), packaging all four ABIs
  (arm64-v8a, armeabi-v7a, x86_64, x86). ⚠️ **Locally it falls back to debug signing** (no
  `SIGNING_*` env present) — CI must inject the release keystore, since a debug-signed AAB
  cannot be uploaded. See §7.

## 3. 16 KB page size (enforced at upload for targetSdk ≥ 35)

- [x] ✅ **All 64-bit `.so` are 16 KB-aligned — verified on the real `.aab`** (2026-07-22).
  This was a **genuine blocker, not a theoretical one**: our own `wgmobile.aar` shipped
  `libgojni.so` at `p_align=4096` (gomobile's default) on both arm64-v8a and x86_64 — Play
  would have rejected the upload. **Fixed** by adding
  `-ldflags="-extldflags=-Wl,-z,max-page-size=16384"` to `gomobile bind` in
  `clients/native/wgnest/build-android.sh`, then rebuilding the AAR.
  **Evidence:** full `app-release.aab` audit → 16/16 arm64-v8a and 16/16 x86_64 libs at
  `0x4000`; 32-bit ABIs exempt. RN 0.86, Hermes, and `com.wireguard.android:tunnel` were
  already compliant — `libgojni.so` was the sole offender. NDK r27 is fine with the flag; no
  r28 bump needed.
  → **`clients/native/wgnest/check-16k.sh`** now audits any `.aar`/`.aab`/`.apk`/`.so` and
  exits non-zero on regression. **Wire it into CI** before the release upload step.

## 4. Payments / crypto — resolved (was blocker #1)

- [x] ✅ Crypto upgrade is **OFF** on Play (live flag `inAppUpgrade.android = false`) — the
  `billing-stance.md` "manage-on-web" posture is active and compliant.
- [ ] ⬜ Declare **In-app purchases: No** in the Console to match the shipped build.
- [ ] ⚠️ Keep it OFF for every store build (guardrail, blocker-list #2) — flipping it on
  post-review is a Payments-policy violation.

## 5. Play Console — App content

- [ ] ⬜ **VpnService declaration** submitted + ≤ 90s demo video.
- [ ] ⬜ **Foreground service types** declaration + video (feature description + defer-impact).
- [x] ✅ **Data safety** answers ready (`store/play/data-safety.md`) — but ⚠️ **fix the
  transit-encryption claim**: it says "TLS for discovery/API," yet the control plane is
  **cleartext HTTP** (ed25519-signed, per `network_security_config.xml`). Say
  "tunnel encrypted via WireGuard; control API integrity-signed, not TLS" so the form matches
  reality. Must be consistent with the privacy policy + VpnService declaration.
- [x] ✅ **Privacy policy** URL live (`cumulusvpn.com/privacy`, verified) — paste into the Play
  Console Privacy policy field.
- [x] ✅ **In-app privacy link added** (2026-07-22). Play wants the policy reachable from
  *within* the app, not only the listing. Settings now has a **"Privacy & support"** section:
  **What data we collect** (opens the in-app disclosure screen), **Privacy Policy**
  (→ `cumulusvpn.com/privacy`) and **Support** (→ `cumulusvpn.com/support`). A first-run
  data-disclosure gate also runs before any connect (shared with the Apple 5.4 requirement).
  Verified: `tsc` clean, `eslint` clean, 29/29 tests pass.
- [x] ✅ **Content rating (IARC)** answers ready (`vpnservice-declaration.md §2`) → Everyone.
- [ ] ⬜ **Permissions declaration** — justify sensitive perms; remove any unused. Avoid
  `QUERY_ALL_PACKAGES`.

## 6. Store listing assets

- [x] ✅ App icon 512×512 (alpha) `store/assets/icon/play-icon-512.png`.
- [x] ✅ Feature graphic 1024×500 (no alpha) `store/assets/play-feature-graphic-1024x500.png`.
- [x] ✅ Listing copy: title (22), short (77), full (<4000) — `store/play/listing.md`.
- [x] ✅ **Phone screenshots** — 5 real captures at 1080×2160 in
  `store/assets/screenshots/android/`. ⬜ Add 7"/10" tablet to avoid "not optimized for tablets."
- [ ] ⬜ Promo video (optional, YouTube URL).

## 7. Signing & account

- [ ] ❓ **Play App Signing** enrolled; **release keystore/secrets present** (repo signs from
  CI env `SIGNING_*`; falls back to **debug** locally — a debug-signed AAB cannot ship).
- [ ] ⬜ Register the **Google-held app-signing SHA-256** with any backend/`assetlinks.json`
  that pins fingerprints (common launch-day breakage). Gateway ed25519 pinning is app-level,
  unaffected.
- [ ] ❓ **New-personal-account closed test: 12 testers × 14 continuous days** (post-Nov-13-2023
  personal accounts). **Organization accounts are exempt.** → Confirm account type; if
  personal, budget ~2 weeks before production.
- [ ] ⬜ (optional) **Play Integrity** to gate premium entitlement / relay access server-side.

## 8. Post-launch (not gating)

- [ ] VPN "Verified" badge later (needs Org account + MASA L2 + 10k installs + 250 reviews +
  90 days).
- [ ] Optional Play Billing for fiat reach.
