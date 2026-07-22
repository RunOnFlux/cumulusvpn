# App Store Submission Readiness Checklist — CumulusVPN (iOS)

> Annotated against the **actual repo state** as of 2026-07-21, not a generic template.
> Sources: current App Review Guidelines (§3.1.1/3.1.3/3.1.5, §5.4), Apple privacy-manifest
> + export-compliance docs, and the repo's own `store/` package.
>
> **Legend:** ✅ done · ⚠️ present but needs a decision/fix · ❌ blocker (submission will be
> rejected/blocked) · ❓ can't verify from repo — confirm before submitting · ⬜ not started

---

## 0. Blockers first (fix these or the app does not ship)

1. ✅ **All iOS screenshots DONE (real captures — iPhone + iPad)** (updated 2026-07-22). The
   placeholder problem is **resolved**: all three iPhone slots —
   **6.9" 1320×2868**, 6.7" 1290×2796, 6.5" 1242×2688 (`store/assets/screenshots/ios/`) — are
   now genuine iOS captures from a **Release build on the iOS 18.6 Simulator (iPhone 16 Pro
   Max)**, framed in the official Apple bezel, with the canonical 9:41 marketing status bar.
   Raws in `store/assets/screenshots/raw/ios/`; all dimensions verified exact. Two caveats:
   - `01-connect.png` is the **disconnected** state — packet-tunnel extensions cannot run on the
     Simulator. Uploadable and truthful as-is (the "One tap. Encrypted." headline reads
     correctly against the tap-to-connect orb), but a **connected** hero frame captured on a
     physical iPhone would be materially stronger marketing.
   - **13" iPad set — DONE** (2026-07-22). Four real captures at **2064×2752** from a Release
     build on the iPad Pro 13-inch (M4) Simulator (`store/assets/screenshots/ios/ipad-13/`,
     raws in `raw/ios-ipad/`). **Unframed** — the compositor has no iPad bezel, and Apple
     accepts unframed screenshots at exact display resolution. Same disconnected-hero caveat as
     iPhone. This satisfies the universal-app iPad requirement.
2. ✅ **Privacy Policy & Support pages LIVE** (blocker cleared, verified 2026-07-21).
   <https://cumulusvpn.com/privacy> serves the full policy (last updated 16 Jul 2026);
   <https://cumulusvpn.com/support> serves the FAQ + contact channels. Both are hard requirements
   Apple validates (5.4 + general). → Just paste the two URLs into App Store Connect (Privacy
   Policy URL + Support URL) at submission.
3. ❓ **Organization enrollment.** 5.4 (and 3.1.5(i) for crypto) require the developer be
   enrolled as an **Organization**, not Individual. `DEVELOPMENT_TEAM = URVD95GYQ7` is set —
   confirm it is an Org account (D-U-N-S). Individual accounts **cannot** ship a VPN.

---

## 1. Account & legal

- [ ] ❓ Enrolled as **Organization** (D-U-N-S) — required by 5.4 + 3.1.5(i).
- [ ] ⬜ **Territory availability** excludes markets requiring a VPN license you don't hold
  (China, Russia, UAE, Oman, Iran, N. Korea, Turkmenistan, Belarus…). Repo already lists
  these in `store/app-store/app-review.md §6` — apply them in App Store Connect → Availability.
  If you *do* enter a license-required market, put the license in Review Notes.
- [ ] ⬜ **Network Extension capability** enabled on the App ID; both app + extension
  provisioning profiles carry the `packet-tunnel-provider` entitlement (request lead time —
  do early).

## 2. Binary / Xcode config — current state

- [x] ✅ Bundle IDs: `com.cumulusvpn.app` + extension `com.cumulusvpn.app.PacketTunnel`.
- [x] ✅ Entitlements (both targets): `com.apple.developer.networking.networkextension =
  [packet-tunnel-provider]` + App Group `group.com.cumulusvpn.app`.
- [x] ✅ Extension `Info.plist`: `NSExtensionPointIdentifier =
  com.apple.networkextension.packet-tunnel`, `NSExtensionPrincipalClass =
  $(PRODUCT_MODULE_NAME).PacketTunnelProvider`.
- [x] ✅ Deployment target 15.1; version 1.0.0 / build 1.
- [ ] ⚠️ **iOS build has an undocumented required pre-step** (found 2026-07-22).
  `clients/native/wgnest/build-ios.sh` must run **before** `xcodebuild` — it produces
  `ios/Frameworks/Wgnest.xcframework`, which is **gitignored** (same as the Android
  `wgmobile.aar`). A clean checkout fails with `error: There is no XCFramework found at
  '…/Frameworks/Wgnest.xcframework'` in both the app and extension targets. → Add it to the
  iOS CI/release pipeline and to the build docs, mirroring `build-android.sh`.
- [ ] ⚠️ **`ITSAppUsesNonExemptEncryption` is `false` — reconsider.** Apple's guidance is that
  a WireGuard VPN (ChaCha20-Poly1305 / Curve25519) uses **non-exempt-strength** crypto and
  should declare **`YES`** + claim the mass-market exemption in the App Store Connect
  questionnaire. The repo's `app-review.md §5` bakes in the `false` stance, which is
  contestable. → Get an export-compliance decision; if `YES`, also confirm whether the
  **Feb 1 annual self-classification report** to BIS/ENC applies.
- [ ] ❓ **Personal-VPN entitlement.** `app-review.md` lists
  `com.apple.developer.networking.vpn.api = allow-vpn`, but it is **not** in the entitlements
  files (only `packet-tunnel-provider` + App Group are). For `NETunnelProviderManager` this is
  usually fine; confirm your manager class doesn't need `allow-vpn`.
- [x] ✅ `NSAppTransportSecurity` allows arbitrary loads (needed — gateways serve control API
  over cleartext HTTP to raw IPs; tunnel traffic is separately WireGuard-encrypted). Allowed
  by Apple; no action.

## 3. Privacy (the consistency triangle must agree)

- [x] ✅ `PrivacyInfo.xcprivacy` present: 3 Required-Reason APIs (FileTimestamp C617.1,
  UserDefaults CA92.1, SystemBootTime 35F9.1), `NSPrivacyTracking = false`, no collected data.
- [x] ✅ **Third-party SDK privacy manifests audited** (2026-07-22, after `pod install`).
  Installed pods are RN 0.86 core + exactly three ecosystem modules (AsyncStorage,
  react-native-get-random-values, react-native-safe-area-context) — **none is on Apple's
  "commonly used SDKs" list**, so the ITMS-91053 signed-manifest requirement doesn't bite.
  RN's prebuilt core ships its manifest via `ReactNativeDependencies` (only pod with a
  `PrivacyInfo.xcprivacy`), and the app-level manifest already declares the Required-Reason
  APIs (FileTimestamp, UserDefaults, SystemBootTime). Final confirmation is the first
  TestFlight upload — processing emails will flag anything missed.
- [x] ✅ **In-app pre-connection data-disclosure screen (5.4) — implemented** (2026-07-22).
  5.4 requires "a clear declaration of what user data will be collected and how it will be used
  **on an app screen prior to any user action**" — a linked policy is **not** sufficient.
  New `src/screens/DisclosureScreen.tsx` renders as a **first-run gate in front of the entire
  app** (`App.tsx`), so the declaration is unavoidable before the service is used. Covers: no
  activity/traffic/DNS logs; no account/email/phone; no third-party analytics or tracking SDKs;
  keypair generated on-device with the private key never leaving it; what a gateway necessarily
  sees (IP + encrypted packets, not retained, operated by independent Flux node operators);
  premium bought on the web with entitlement checked by public key alone. Acknowledgement
  persists via `DISCLOSURE_VERSION` in `state/storage.ts` — **bump it to re-prompt** on a
  material policy change. Re-openable from Settings → "What data we collect".
  Verified: `tsc` clean, `eslint` clean, 29/29 tests pass.
  ⚠️ This screen, the App Privacy label and `PrivacyInfo.xcprivacy` must stay mutually
  consistent — reviewers cross-check all three.
- [ ] ⬜ **App Privacy label** in ASC = "Data Not Collected" (repo's
  `privacy-nutrition-label.md` is ready) — must match the manifest + policy exactly. VPNs get
  manual scrutiny here.

## 4. In-app purchase / crypto (3.1.1)

- [x] ✅ **FLUX crypto pay is OFF on iOS** — live flag `inAppUpgrade.ios = false` in the
  dashboard KV (verified 2026-07-22; `https://dashboard.cumulusvpn.com/api/flags` →
  `{"android":false,"ios":false}`), so `UpgradeScreen` renders the "manage on web" copy — no
  QR/wallet/address. Required: 3.1.1 *literally names* "QR codes, cryptocurrencies and
  cryptocurrency wallets" as prohibited unlock mechanisms. ⚠️ This is a **runtime remote flag,
  not a build-time lock** — keep it `false` for any build under or past review (enabling a
  payment path post-review is a 2.3.1 behavior-change violation). A build-time hard-off gate
  for store variants was deferred.
- [ ] ⚠️ **Metadata external-purchase language.** The `listing.md` description ("PREMIUM IS
  MANAGED ON THE WEB … purchased with FLUX cryptocurrency … on our website") is external-
  purchase steering. The US storefront now permits external links, but **non-US anti-steering
  still applies to metadata**. → Keep it descriptive with **no URL/CTA/button**; safest to
  minimize the "buy on our website" phrasing outside the US storefront.
- [ ] ❓ **How does a user get premium on iOS? (3.1.3(b)).** If web-bought premium is *honored*
  on iOS but not *sellable* in-app, non-US reviewers can flag it. Lowest-risk options:
  (a) add an Apple auto-renewing IAP for premium, or (b) ship iOS free-tier-only with no
  upgrade UI at all. Decide before submission.
- [x] ✅ Account deletion (5.1.1(v)) — **N/A**, the app has no accounts (key-based identity).

## 5. App Store Connect content

- [x] ✅ Listing copy ready (`store/app-store/listing.md`): name (10), subtitle (24), promo
  (162), keywords (89), description (<4000) — all within limits.
- [ ] ⬜ **Age rating — redo under the new system.** The new questionnaire (4+/9+/13+/16+/18+)
  is now mandatory (deadline Jan 31 2026 has passed). The repo's `app-review.md §4` predates
  it. Answer honestly; "unrestricted web access = yes" for a VPN may push the rating up — do
  not contest.
- [ ] ⬜ **Review Notes:** paste `app-review.md §2` (no account needed; connect steps;
  guaranteed-up test region; NE justification). Ensure **at least one gateway is reachable from
  Apple review infra (US)** at review time.
- [x] ✅ Support URL (`cumulusvpn.com/support`) + Privacy Policy URL (`cumulusvpn.com/privacy`)
  live and verified — paste both into App Store Connect at submission.

## 6. Assets

- [x] ✅ App icon 1024×1024, no alpha (`store/assets/icon/ios-appstore-1024.png`).
- [x] ✅ **iPhone screenshots** — 6.9" **1320×2868** (the base slot, not 1290×2796 which is
  6.7"), 6.7" 1290×2796 and 6.5" 1242×2688 are all **real iOS captures**, correctly framed and
  verified at exact dimensions (see §0.1 for the disconnected-hero caveat). (Repo's
  `assets-checklist.md` still says "6.7" required" — outdated; 6.9" is the base.)
- [x] ✅ **13" iPad (2064×2752) set** — 4 real captures in `ios/ipad-13/`, unframed at exact
  resolution (Apple-accepted). Satisfies the universal-app requirement (see §0.1).
- [ ] ⬜ App preview video (optional, 15–30s).

## 7. Pre-submission verification

- [ ] ⬜ TestFlight build passes processing (export-compliance + privacy-manifest gates fire
  here first).
- [ ] ⬜ Connect works on an **IPv6-only** network (Apple reviews on IPv6).
- [ ] ⬜ Cold-start / airplane-mode-toggle / network-change tested on a real device.
- [ ] ⬜ 4.2 minimum-functionality: app has server picker, status, settings, help (it does —
  country→city drill-down helps).

## 8. Post-launch (not gating)

- [ ] Consider adding Apple IAP for fiat reach.
- [ ] Transparency report; keep policy ⇄ label ⇄ manifest in sync on every update.
