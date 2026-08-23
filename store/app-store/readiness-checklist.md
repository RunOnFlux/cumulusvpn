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
3. ✅ **Organization enrollment — confirmed** (2026-07-22). The team is an existing Apple
   Developer **Organization** account with other shipped apps, satisfying 5.4 (and 3.1.5(i) for
   crypto), which bar Individual accounts from VPN apps. `DEVELOPMENT_TEAM = URVD95GYQ7`.

---

## 1. Account & legal

- [x] ✅ Enrolled as **Organization** — confirmed (existing Org account with other apps),
  required by 5.4 + 3.1.5(i).
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
  plan entitlement checked by public key alone, nothing sold inside the app (reworded
  2026-07-30 — the old copy said "premium is purchased on the web with FLUX", which is 3.1.1
  steering on the very first screen a reviewer sees). Acknowledgement
  persists via `DISCLOSURE_VERSION` in `state/storage.ts` — **bump it to re-prompt** on a
  material policy change. Re-openable from Settings → "What data we collect".
  Verified: `tsc` clean, `eslint` clean, 29/29 tests pass.
  ⚠️ This screen, the App Privacy label and `PrivacyInfo.xcprivacy` must stay mutually
  consistent — reviewers cross-check all three. ⚠️ 2026-08-09: with IAP subscriptions now sold
  in-app (§9), verify the disclosure copy no longer claims "nothing is sold inside the app"
  and mentions the retained purchase confirmation; bump `DISCLOSURE_VERSION` if reworded.
- [ ] ⬜ **App Privacy label** in ASC — updated 2026-08-09 for IAP: now **"Yes, we collect"**
  with exactly one type — Purchases → Purchase History (App Functionality, not linked, not
  tracking); Financial Info stays No. The "Data Not Collected" badge is **lost** (accepted).
  Repo's `privacy-nutrition-label.md` is updated — must match the manifest + policy exactly.
  VPNs get manual scrutiny here.

## 4. In-app purchase / crypto (3.1.1)

> **Update 2026-08-09 — Apple IAP adopted.** The iOS build now sells two auto-renewable
> subscriptions via StoreKit 2 (see §9). Everything below about the **crypto/FLUX** purchase
> surface (`inAppUpgrade`) remains true and in force. The IAP subscribe UI is a separate
> surface, gated by the `iapPurchase` remote flag (fails closed OFF; must be ON through
> review — see §9). On iOS the app must show ONLY the IAP surface: zero FLUX/crypto/price/
> web-purchase mentions (3.1.1/3.1.3).
>
> **Update 2026-08-23 — the build-level iOS exclusion was removed.** `resolveFlags` no longer
> filters by platform; all three flags are plain per-platform KV toggles on iOS and Android,
> and `voucherRedeem` on iOS is now settable too. Read this as a deliberate trade: the
> protection below is now **operational, not structural**. A KV misconfiguration — or anyone
> with the dashboard password — can put the crypto UI into a live App Store build at its next
> launch, which is the exact condition that caused the 1.0.2 (15) rejection. The KV values are
> the control; keep `inAppUpgrade.ios` false and re-check it before every submission.

- [x] ✅ **Crypto purchase UI is OFF on iOS** (resolved 2026-07-30 after the 1.0.2 (15)
  rejection under 3.1.1). Enforcement changed on 2026-08-23: it was a build-level allowlist in
  `clients/mobile/src/lib/flags.ts` that made a remote flip impossible; it is now the
  `inAppUpgrade.ios` KV flag alone, which fails closed but IS flippable. **Verify it reads
  false before every submission** — this is a checklist item now, not an invariant. When the
  flag is off the app shows **no
  purchase surface at all**: no upgrade route (`App.tsx`), no upsell line / tappable tier pill
  (`ConnectScreen`), a non-interactive plan status row (`SettingsScreen`), and the former
  "manage on the web" copy (steps + URL + FLUX price) is deleted from `UpgradeScreen` — the
  1.0.2 rejection showed Apple treats that copy as external-purchase steering even without a
  tappable link. Live KV flag stays `false` for both platforms as a second layer.
- [x] ✅ **Metadata external-purchase language removed** (2026-07-30): `listing.md` no longer
  contains "PREMIUM IS MANAGED ON THE WEB", "upgrade with FLUX", or the `crypto` keyword; the
  description mentions the free tier only (price info in the description is permitted per
  2.3.7), with no premium-purchase or website-payment references.
- [x] ✅ **Premium on iOS (3.1.3(b))**: originally resolved as "no purchase surface" — premium
  was never offered, priced, or referenced in the iOS app or metadata; a device whose key
  already had premium entitlement simply ran at full speed (neutral status chip). The "if we
  later want to SELL premium to iOS users, that requires Apple IAP" branch has now been taken:
  premium IS sold on iOS, exclusively via Apple IAP (§9). The no-external-steering posture is
  unchanged — StoreKit is the only purchase surface.
- [x] ✅ Account deletion (5.1.1(v)) — **N/A**, the app has no accounts (key-based identity).

## 5. App Store Connect content

- [x] ✅ Listing copy ready (`store/app-store/listing.md`): name (10), subtitle (24), promo
  (149), keywords (82), description (<4000) — all within limits. Revised 2026-07-30 to drop
  all purchase/price steering (3.1.1) after the 1.0.2 rejection.
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

- [x] ✅ ~~Consider adding Apple IAP for fiat reach.~~ **Done** (2026-08-09) — see §9.
- [ ] Transparency report; keep policy ⇄ label ⇄ manifest in sync on every update.

## 9. IAP setup — auto-renewable subscriptions (added 2026-08-09)

The iOS build sells two auto-renewable subscriptions via StoreKit 2 (react-native-iap);
purchases carry an `appAccountToken` (a UUID one-way derived from the device's pseudonymous
payment code). Receipts are verified by the payments bridge (docs/18-payments-bridge.md) at
pay.cumulusvpn.com; entitlement stays chain-only (gateways unchanged). Setup, in order:

- [ ] ⬜ **Paid Applications agreement** active (App Store Connect → Business/Agreements, Tax,
  and Banking): agreement signed, bank account + tax forms complete. Nothing sells until this
  is green.
- [ ] ⬜ **Subscription group "Premium"** with the two products:
  `cvpn.premium.monthly` ($1.99/month) and `cvpn.premium.annual` ($14.99/year). Localized
  display names ("Premium Monthly" / "Premium Annual"), descriptions, and a **review
  screenshot** for each product (required before a sub can be submitted).
- [ ] ⬜ **App Store Server Notifications V2** URL set to
  `https://pay.cumulusvpn.com/v1/apple/notifications` — for **both sandbox and production**
  (App Store Connect → App Information → App Store Server Notifications). This is how the
  payments bridge learns about renewals/cancellations.
- [ ] ⬜ **App Privacy answers updated** in ASC to match the new `privacy-nutrition-label.md`
  (Purchases → Purchase History collected; badge lost — see §3).
- [ ] ⬜ **Sandbox testers** created (Users and Access → Sandbox) and the full
  purchase/restore/renewal flow exercised in sandbox on a real device before submission.
- [ ] ⬜ **First-sub-submitted-with-build rule:** the first auto-renewable subscription(s) must
  be submitted for review **together with a new app build** (select them on the version page).
  Subsequent subscription changes can be reviewed independently.
- [ ] ⬜ **Flip `iapPurchase.ios = true` in the Cloudflare KV BEFORE submitting for review.**
  The flag fails closed OFF; reviewers must find the declared IAPs in the app or the
  submission is rejected (2.1/3.1.1). After approval the flag is an emergency kill switch
  only — never OFF during a review window.

## 10. Offer codes & vouchers (added 2026-08-10)

- [ ] ⬜ **Apple Offer Codes** (the store-sanctioned "enter a code" path on iOS): App Store
  Connect → the app → Subscriptions → group "Premium" → the subscription → **Offer Codes** →
  create one-time-use batches or custom codes (free months or discounted periods). The app
  presents Apple's native redemption sheet ("Redeem an offer code" on the Upgrade screen, via
  `presentCodeRedemptionSheetIOS`); redemptions arrive as ordinary IAP transactions through the
  bridge's verify/notification path — no bridge configuration needed.
- [ ] ⬜ **Our voucher codes on iOS**: never redeemable in-app (3.1.1 — custom unlock codes).
  Users redeem at vpn.cumulusvpn.com using the **Device code** shown in Settings → About.
  Support copy may point there; the APP must not (no external-purchase steering).
- [ ] ⬜ Reviewer notes: if an offer-code campaign is live during review, mention where the
  redemption sheet is (Upgrade screen), and that the in-app "Device code" row is a neutral
  device identifier used for support.
