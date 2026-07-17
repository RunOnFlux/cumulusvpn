# 12 — Store submission runbook (iOS App Store + Google Play)

End-to-end, human-executable steps to get **CumulusVPN** into the Apple App Store and Google
Play. Cross-references **docs/05** (clients + store policy) and **docs/06** (legal/abuse,
availability). All the listing copy, privacy answers, and form answers this runbook tells you to
paste live under `store/` — this doc is the *sequence*, `store/` is the *content*.

- App display name: **CumulusVPN**
- iOS app bundle ID: `com.cumulusvpn.app` · Packet Tunnel extension: `com.cumulusvpn.app.PacketTunnel`
- Android package: `com.cumulusvpn.app`
- Support/marketing site: `https://cumulusvpn.com` · Privacy: `https://cumulusvpn.com/privacy`
- Stack: React Native 0.86, WireGuardKit (iOS NE), `com.wireguard.android:tunnel` (Android VpnService)

Files you'll paste from:
```
store/privacy-policy.md
store/app-store/{listing,privacy-nutrition-label,app-review}.md
store/play/{listing,data-safety,vpnservice-declaration,billing-stance}.md
store/assets-checklist.md   + store/assets/**  (icons, feature graphic)
```

---

## Part A — Prerequisites (do once, human + paid accounts)

These CANNOT be automated in this environment — they need paid enrollment, a browser, and 2FA.

### A1. Apple Developer Program — ORGANIZATION account (mandatory for VPN)
Apple Guideline **5.4 requires VPN apps to come from an organization**, not an individual.
- Enroll at https://developer.apple.com/programs/enroll ($99/yr). Organization enrollment needs a
  **legal entity name + D-U-N-S number** (free from Dun & Bradstreet, allow days–weeks). Tie this
  to the CumulusVPN operating entity chosen in docs/06 §5.
- **Missing/manual:** the entity + D-U-N-S. Until the org account exists, no VPN build can ship.

### A2. Request the Network Extension entitlement (Apple-gated, can take days)
The `com.apple.developer.networking.networkextension` capability for **packet-tunnel-provider**
must be **granted by Apple** before a build using it will validate/upload.
- Request: https://developer.apple.com/contact/request/network-extension/
- Paste the justification verbatim from `store/app-store/app-review.md` §1.
- **Missing/manual:** Apple's approval. Plan for a multi-day wait; do this first.

### A3. Google Play Developer account
- Register at https://play.google.com/console ($25 one-time). For an **organization** account
  Google now requires D-U-N-S + verification too (allow days).
- **Missing/manual:** account + org verification.

### A4. Domain + email + policy hosting
- `cumulusvpn.com` must resolve and host `/privacy`, `/support` (from `store/privacy-policy.md`).
- Working inboxes: `support@`, `privacy@`, `abuse@`, `info@cumulusvpn.com`.
- **Missing/manual:** DNS + mailboxes + publishing the policy page.

---

## Part B — iOS: identifiers, signing, capabilities

### B1. App IDs & capabilities (Apple Developer → Certificates, IDs & Profiles)
Create two App IDs:
1. `com.cumulusvpn.app` (main app) — enable **Personal VPN** and **Network Extensions**.
2. `com.cumulusvpn.app.PacketTunnel` (extension) — enable **Network Extensions
   (Packet Tunnel Provider)**.
Create an **App Group** shared by both: `group.com.cumulusvpn.app` (on-device config hand-off).

Entitlement values (see `store/app-store/app-review.md` §1):
- `com.apple.developer.networking.networkextension` = `packet-tunnel-provider`
- `com.apple.developer.networking.vpn.api` = `allow-vpn`
- `com.apple.security.application-groups` = `group.com.cumulusvpn.app`

### B2. Signing certificates & provisioning profiles
- Create an **Apple Distribution** certificate and **App Store** provisioning profiles for BOTH
  the app and the extension IDs (each embedding the entitlements above).
- Easiest path: let Xcode "Automatically manage signing" per target once the org account +
  entitlement (A2) are approved; otherwise create profiles manually in the portal.
- **Missing/manual:** certificate/private key on the build Mac + profiles (need approved A2).

### B3. Register the app in App Store Connect
- https://appstoreconnect.apple.com → Apps → **+** → New App.
  - Platform iOS, Name **CumulusVPN**, Primary language English (U.S.), Bundle ID
    `com.cumulusvpn.app`, SKU e.g. `cumulusvpn-ios`.

---

## Part C — iOS: build, archive, upload

Local commands (these DO run here up to the point that needs signing/accounts):

```bash
cd clients/mobile
yarn install                       # JS deps (yarn only, exact versions — house rule)
cd ios
pod install                        # generates CumulusVPN.xcworkspace (WireGuardKit pulls a Go toolchain in CI)
```
> Note: `wireguard-apple` compiles a Go bridge; ensure Go is on the build machine/CI. The
> `.xcworkspace` does not exist until `pod install` runs.

Set the marketing/build version and the export-compliance key in `Info.plist` (see
`store/app-store/app-review.md` §5):
```xml
<key>ITSAppUsesNonExemptEncryption</key><false/>
```

Wire the app icon: drop `store/assets/icon/ios-appstore-1024.png` into the asset catalog's
**AppIcon** (single-size 1024 is accepted by modern Xcode; other `ios-*.png` are there for older
catalogs).

Archive + upload — **two supported paths**:

**Path 1 — Xcode GUI (simplest):**
1. Open `clients/mobile/ios/CumulusVPN.xcworkspace`.
2. Select the **CumulusVPN** scheme, destination **Any iOS Device (arm64)**.
3. Set the same signing team on **both** the app and PacketTunnel targets.
4. Product → **Archive** → Organizer → **Distribute App** → **App Store Connect** → Upload.

**Path 2 — command line (CI-friendly):**
```bash
cd clients/mobile/ios
xcodebuild -workspace CumulusVPN.xcworkspace -scheme CumulusVPN \
  -configuration Release -sdk iphoneos -archivePath build/CumulusVPN.xcarchive \
  archive DEVELOPMENT_TEAM=<TEAMID>
xcodebuild -exportArchive -archivePath build/CumulusVPN.xcarchive \
  -exportOptionsPlist ExportOptions.plist -exportPath build/export
# then upload the .ipa:
xcrun altool --upload-app -f build/export/CumulusVPN.ipa -t ios \
  --apiKey <KEY_ID> --apiIssuer <ISSUER_ID>       # App Store Connect API key
# (or use Transporter.app to drag-and-drop the .ipa)
```
`ExportOptions.plist` needs `method=app-store` and the provisioning profile mapping for both
targets.
- **Missing/manual:** `<TEAMID>`, the distribution cert/profiles (B2), and an App Store Connect
  **API key** (or Transporter login). None exist in this environment.

---

## Part D — iOS: App Store Connect metadata & submit

In App Store Connect → CumulusVPN → the new version:
1. **App Information:** category Utilities (secondary Productivity), from `store/app-store/listing.md`.
2. **Pricing and Availability → Availability:** deselect the prohibited markets in
   `store/app-store/app-review.md` §6 (China mainland, Russia, UAE, Oman, Iran, North Korea,
   Turkmenistan, Belarus, + any counsel adds). Cross-ref docs/05 & docs/06.
3. **App Privacy:** enter answers from `store/app-store/privacy-nutrition-label.md` → results in
   **Data Not Collected**. Set Privacy Policy URL.
4. **Version page:** paste Name/Subtitle/Promo/Description/Keywords/Support URL and What's New
   from `store/app-store/listing.md`. Upload screenshots (6.7" required; see assets-checklist —
   still to be captured from the running app).
5. **App Review Information → Notes:** paste the reviewer notes from
   `store/app-store/app-review.md` §2 (the 3.1.1 "manage-on-web / no IAP" explanation is the key
   part). Contact email `info@cumulusvpn.com`.
6. **Age Rating:** answer per §4 (all None; VPN=yes where asked) → 4+/17+.
7. **Export Compliance:** already handled by the Info.plist key; if prompted, answer per §5 (no
   CCATS/ERN — standard crypto exemption).
8. Attach the uploaded build → **Add for Review** → **Submit**.

Expect a VPN-specific review (they will test the tunnel and check for in-app purchase). The
manage-on-web design is what keeps 3.1.1 clean — do not add any "Buy" button to the iOS build.

---

## Part E — Android: identifiers, signing, build (AAB)

### E1. App signing
- Use **Play App Signing** (recommended): you upload with an **upload key**, Google holds the app
  signing key. Generate the upload keystore:
```bash
keytool -genkeypair -v -keystore cumulusvpn-upload.keystore \
  -alias cumulusvpn -keyalg RSA -keysize 2048 -validity 10000
```
- Wire it into `clients/mobile/android/app/build.gradle` (`signingConfigs.release`) via
  `~/.gradle/gradle.properties` (never commit the keystore or passwords).
- **Missing/manual:** the keystore + passwords (secrets; not created here).

### E2. Icons & version
- Adaptive icon: place `store/assets/icon/android-adaptive-foreground-432.png` and
  `...-background-432.png` into `android/app/src/main/res/mipmap-anydpi-v26` (as
  `ic_launcher_foreground`/`_background`), and the legacy `android-launcher-*.png` into
  `mipmap-{mdpi..xxxhdpi}`.
- Set `versionCode`/`versionName` and confirm `targetSdkVersion` meets Play's current minimum.
- Ensure the tunnel runs as a **foreground service with an ongoing notification** (VpnService
  requirement — see `store/play/vpnservice-declaration.md`).

### E3. Build the release AAB
```bash
cd clients/mobile
yarn install
cd android
./gradlew bundleRelease        # -> app/build/outputs/bundle/release/app-release.aab
```
- **Missing/manual:** signing config (E1). Without it Gradle produces an unsigned/ debuggable
  bundle that Play will reject.

---

## Part F — Android: Play Console setup, upload, declarations, submit

In https://play.google.com/console → Create app (Name **CumulusVPN**, App, Free, declarations):
1. **App content** — complete every card:
   - **Privacy policy:** `https://cumulusvpn.com/privacy`.
   - **Data safety:** enter from `store/play/data-safety.md` → **No data collected/shared**.
   - **VPN service:** declare from `store/play/vpnservice-declaration.md` §1.
   - **Content rating:** IARC questionnaire per `store/play/vpnservice-declaration.md` §2 → general.
   - Ads: **No**. Target audience: adults (not Families). Government/financial: No. News: No.
2. **Main store listing:** paste Title/Short/Full from `store/play/listing.md`; upload
   `store/assets/icon/play-icon-512.png`, `store/assets/play-feature-graphic-1024x500.png`, and
   phone screenshots (min 2 — capture from the running app; see assets-checklist).
3. **Store settings:** Category **Tools**; In-app purchases **No** (see
   `store/play/billing-stance.md` — no Play Billing at launch).
4. **Production → Countries/regions:** exclude the same prohibited markets as iOS
   (`store/app-store/app-review.md` §6); cross-ref docs/06.
5. **Production → Create release:** upload `app-release.aab`, add release notes from
   `store/play/listing.md`, review, **roll out** (start with a closed/internal test track first if
   you want a staged rollout).

Play reviews VPN apps against the VpnService/VPN policy and cross-checks Data safety vs the
privacy policy vs an automated traffic scan — keep all three consistent (they are, by design).

---

## Part G — Per-market availability (shared, both stores)

Exclude at minimum (finalize with counsel — docs/08 #10, docs/06 §5):
**China mainland, Russia, UAE, Oman, Iran, North Korea, Turkmenistan, Belarus**, plus any market
where consumer VPNs require a license we don't hold. Apply the **same** list on App Store Connect
Availability and Play Console Countries so the two catalogs match. This satisfies Apple 5.4
"available only where legal" and keeps our legal posture (docs/06) consistent.

---

## Part H — What stays manual (summary)

| Item | Why it can't be done here | Where it goes |
|---|---|---|
| Apple org enrollment + D-U-N-S | Paid, entity + browser/2FA | A1 |
| Network Extension entitlement approval | Apple-gated, multi-day | A2 |
| Play developer account + org verification | Paid, browser | A3 |
| cumulusvpn.com + mailboxes + hosted policy | DNS/hosting | A4 |
| iOS distribution cert + profiles | Needs org account + approved entitlement | B2 |
| App Store Connect API key / Transporter login | Secret credential | C |
| Android upload keystore + passwords | Secret material | E1 |
| Real screenshots | Need a running build on device/simulator | assets-checklist |
| Final excluded-markets list | Legal sign-off | G, docs/06/08 |

Everything else — all listing copy, privacy/data-safety/VpnService/content-rating answers,
reviewer notes, export-compliance guidance, icon set, and the Play feature graphic — is prepared
under `store/` and ready to paste/upload.

See also: **docs/05** (why manage-on-web, store policy rationale) and **docs/06** (no-logs legal
posture, datacenter-only placement, availability).
