# 14 — App releases (Android · Desktop · iOS)

Signed release pipelines for the native apps, mirroring the ssp-key setup. All are
**tag-triggered** and publish artifacts to a GitHub Release. The gateway image and
the two websites already auto-deploy (see `.github/workflows/README.md`).

| App | Workflow | Trigger tag | Output |
|---|---|---|---|
| Android | `android-release.yml` | `mobile-v*` | signed **APK + AAB** → GitHub Release |
| Desktop | `desktop-release.yml` | `desktop-v*` | macOS `.dmg`, Windows `.msi/.exe`, Linux `.AppImage/.deb` (matrix) |
| iOS | Xcode Cloud (+ `ios/ci_scripts/`) | (Xcode Cloud UI) | TestFlight / App Store |

> **Generate the keys yourself** with the commands below — don't paste private keys
> into chat/issues. They go straight into **GitHub → Settings → Secrets and
> variables → Actions**. Back each one up in a password manager: losing a signing
> key can mean you can't ship updates.

## Android

Uses a base64-encoded upload keystore stored as a secret, decoded at build time
(identical to ssp-key). `clients/mobile/android/app/build.gradle` already reads the
`SIGNING_*` env; local builds fall back to the debug key.

**1. Generate the upload keystore** (once):
```bash
keytool -genkeypair -v \
  -keystore cumulusvpn-release.keystore \
  -alias cumulusvpn -keyalg RSA -keysize 2048 -validity 10000 \
  -dname "CN=CumulusVPN, O=InFlux Technologies LLC, C=US"
# prompts for a keystore password and a key password — remember both.

base64 -i cumulusvpn-release.keystore | pbcopy   # macOS: now on your clipboard
```

**2. Add secrets** (repo → Settings → Secrets → Actions):

| Secret | Value |
|---|---|
| `ANDROID_SIGNING_KEY` | the base64 blob from step 1 |
| `ANDROID_ALIAS` | `cumulusvpn` |
| `ANDROID_KEY_STORE_PASSWORD` | the keystore password |
| `ANDROID_KEY_PASSWORD` | the key password |

**3. Release:** `git tag mobile-v1.0.0 && git push origin mobile-v1.0.0` → the
workflow builds the signed APK + AAB and attaches both to a GitHub Release. Upload
the **AAB** to the Play Console. Keep the keystore safe — with **Play App Signing**
Google re-signs, but this upload key is still your identity to Play.

*(Optional)* auto-upload to Play: add a Play service-account JSON secret and a
`r0adkll/upload-google-play` step — deferred; upload manually for the first release.

## Desktop (Tauri)

`desktop-release.yml` builds all platforms via `tauri-action`. The **updater** is
enabled (`tauri.conf.json`), so it needs an updater signing key.

**1. Generate the updater key:**
```bash
cd clients/desktop
yarn tauri signer generate -w cumulusvpn-updater.key
# prints a PUBLIC key and writes the private key to cumulusvpn-updater.key (gitignored)
```
- Put the **public key** into `clients/desktop/src-tauri/tauri.conf.json` under
  `plugins.updater.pubkey` (and set `plugins.updater.endpoints` to your release
  feed, e.g. the GitHub Releases `latest.json`).
- Secrets: `TAURI_SIGNING_PRIVATE_KEY` = the contents of `cumulusvpn-updater.key`;
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` = the password you set.

**2. macOS sign + notarize** (optional — needed for a Gatekeeper-clean `.dmg`;
requires an Apple Developer account): add `APPLE_CERTIFICATE`,
`APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`,
`APPLE_PASSWORD` (app-specific password), `APPLE_TEAM_ID`. Without them the build
still produces unsigned installers.

**3. Release:** `git tag desktop-v1.0.0 && git push origin desktop-v1.0.0` → a
matrix build (macOS arm64 + x64, Windows, Linux) publishes a **draft** GitHub
Release with the installers.

> ⚠️ **Sidecar gap:** the tunnel needs the `wireguard-go` binary per target triple.
> `clients/desktop/scripts/fetch-wireguard-go.sh` currently vendors only
> `aarch64-apple-darwin`; extend it to build/fetch for each platform (Go cross-compile
> of wireguard-go) or the Windows/Linux/x64-mac bundles will fail to resolve the
> sidecar. This is the main remaining desktop-release task.

## iOS (Xcode Cloud)

iOS release runs on **Xcode Cloud** (Apple's CI, set up in Xcode / App Store
Connect — not GitHub Actions), because signing + TestFlight upload are tied to your
Apple account. The repo provides `clients/mobile/ios/ci_scripts/ci_post_clone.sh`,
which installs Node/Yarn, builds `@cumulusvpn/core`, runs `pod install`, and
provisions **Go 1.22** for the WireGuardKit `libwg-go.a` build phase (docs/13).

**Prerequisites** (all on your side):
1. Finish the iOS build wiring in `docs/13-ios-build.md` (repoint SPM to the vendored
   patched wireguard-apple + add the `libwg-go.a` Makefile build phase).
2. Apple Developer **org** account (Apple 5.4 requires org accounts for VPN apps).
3. App registered in **App Store Connect** with bundle IDs `com.cumulusvpn.app` +
   `com.cumulusvpn.app.PacketTunnel`, and the **Network Extension** (packet-tunnel)
   entitlement + `group.com.cumulusvpn.app` App Group approved.
4. In **Xcode → Product → Xcode Cloud → Create Workflow**: connect the GitHub repo,
   point at `clients/mobile/ios/CumulusVPN.xcworkspace`, scheme `CumulusVPN`,
   Archive → TestFlight, triggered on `mobile-v*` tags. Signing is **managed by
   Xcode Cloud** (no certs in GitHub).

No GitHub secrets are needed for iOS — signing lives in App Store Connect.

## Secrets summary

| Secret | Used by | Who provides |
|---|---|---|
| `ANDROID_SIGNING_KEY` / `ANDROID_ALIAS` / `ANDROID_KEY_STORE_PASSWORD` / `ANDROID_KEY_PASSWORD` | Android | you (keytool) |
| `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Desktop updater | you (tauri signer) |
| `APPLE_*` (6) | Desktop macOS notarization | Apple Developer acct (optional) |
| — (Xcode Cloud) | iOS | App Store Connect |

## Versioning

Bump `versionCode`/`versionName` in `clients/mobile/android/app/build.gradle`,
`version` in `clients/desktop/src-tauri/tauri.conf.json`, and the iOS project version
to match the tag before tagging. (A future improvement: derive them from the tag in CI.)
