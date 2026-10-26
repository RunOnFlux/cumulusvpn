# 14 — App releases (Android · Desktop · iOS)

Signed release pipelines for the native apps, mirroring the ssp-key setup. All are
**tag-triggered** and publish artifacts to a GitHub Release. The gateway image and
the two websites already auto-deploy (see `.github/workflows/README.md`).

| App     | Workflow                          | Trigger tag      | Output                                                                                 |
| ------- | --------------------------------- | ---------------- | -------------------------------------------------------------------------------------- |
| Android | `android-release.yml`             | `mobile-v*`      | signed **APK + AAB** → GitHub Release                                                  |
| Desktop | `desktop-release.yml`             | `desktop-v*`     | macOS Apple Silicon, Linux x86_64 and Windows x86_64 installers (draft GitHub Release) |
| iOS     | Xcode Cloud (+ `ios/ci_scripts/`) | (Xcode Cloud UI) | TestFlight / App Store                                                                 |

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

| Secret                       | Value                       |
| ---------------------------- | --------------------------- |
| `ANDROID_SIGNING_KEY`        | the base64 blob from step 1 |
| `ANDROID_ALIAS`              | `cumulusvpn`                |
| `ANDROID_KEY_STORE_PASSWORD` | the keystore password       |
| `ANDROID_KEY_PASSWORD`       | the key password            |

**3. Release:** `git tag mobile-v1.0.0 && git push origin mobile-v1.0.0` → the
workflow builds the signed APK + AAB and attaches both to a GitHub Release. Upload
the **AAB** to the Play Console. Keep the keystore safe — with **Play App Signing**
Google re-signs, but this upload key is still your identity to Play.

_(Optional)_ auto-upload to Play: add a Play service-account JSON secret and a
`r0adkll/upload-google-play` step — deferred; upload manually for the first release.

## Desktop (Tauri)

`desktop-release.yml` builds three legs with `tauri-action` and publishes them to
a **draft** GitHub Release on a `desktop-v*` tag (a manual run only builds):

| Leg                 | Runner           | Artifacts                                    | Privileged helper                                                                         |
| ------------------- | ---------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| macOS Apple Silicon | `macos-latest`   | `.dmg`, `.app.tar.gz`                        | LaunchDaemon inside the `.app`, registered with `SMAppService`                            |
| Linux x86_64        | `ubuntu-latest`  | `.deb`, `.rpm`, `.AppImage`                  | systemd service from the `.deb` / `.rpm`; the AppImage runs the tunnel in-process as root |
| Windows x86_64      | `windows-latest` | NSIS `-setup.exe`, `.msi` (both per-machine) | `CumulusVPNHelper` LocalSystem service; the tunnel runs only in that service on Windows   |

Each leg builds the `wireguard-go` (AmneziaWG) sidecar from source
(`scripts/fetch-wireguard-go.sh`) and the helper (`scripts/build-helper.mjs`),
then installs the packages on the runner and checks the service, its
permissions, peer authentication and uninstall cleanup. The Windows leg also
fetches the pinned `wintun.dll` (SHA256-checked). Intel Macs have no leg.

The latest published release is `desktop-v1.2.0` (2026-08-23), with all seven
artifacts above. Tags `desktop-v1.3.0` to `desktop-v1.4.1` exist without a
published release. The repo's version strings say `1.4.1`, and the working tree
carries the unreleased changes below, so the next release needs a new version.

**The app and the helper ship as a pair.** They speak the protocol in
`src-tauri/protocol`, which has no version negotiation: multi-hop is two
requests (`connect_multihop_entry`, `connect_multihop_exit`), and a helper from
`1.4.1` or earlier does not know them. Every package installs both and restarts
the helper.

### Unreleased desktop changes (since `desktop-v1.4.1`)

**Windows**

- The tunnel runs only in the `CumulusVPNHelper` service; there is no
  Run-as-Administrator mode.
- Routes, addresses, adapter DNS, the kill switch and the DNS leak block use
  IP Helper and WFP directly (no PowerShell or `netsh`). Routes the service adds
  on the physical interface are recorded in `routes.txt` and removed at the next
  start after a crash.
- Gateway requests go through the native HTTP client, so discovery works in
  WebView2.
- The MSI closes a running app before it replaces it.

**All platforms**

- Multi-hop:
  - The entry hop comes up first, with the exit gateway's IP routed through it.
    The enroll at the exit then leaves inside the entry tunnel, on a key made
    for that session alone, so the exit never sees the user's IP or account key.
    The exit hop runs at the exit gateway's free tier.
  - The exit is never a gateway the app has sent the account key to since launch.
  - An entry and exit that assign the same tunnel address are replaced by the
    next pair.
  - Entitlement is checked at the entry.
- The kill switch allows the gateway control port (51821).
- The enroll proof-of-work is solved natively on every core: milliseconds,
  where the webview's JavaScript took up to several seconds per enroll.
- Discovery reports gateways as they verify. The app is ready once the
  country it opens on has one (about 250 ms on the test machine); unreachable
  gateways no longer hold it for their 12 s timeout.
- Interface:
  - The kill switch is pinned above Connect.
  - The connect orb and status are pinned under the title bar.
  - A user disconnect no longer shows "connection lost".
- Logs:
  - `desktop.log` and the helper's log are capped at 1 MiB, with one older
    part kept as `<name>.1`.
  - The macOS helper logs to `/Library/Logs/CumulusVPN/helper.log`.
  - Discovery logs one summary line and its failures.

See `docs/11-multihop.md` and the desktop README's "Logs" section.

**Signing.** All three legs build unsigned by default:

- **macOS:** add `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`,
  `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` (app-specific
  password) and `APPLE_TEAM_ID` for a signed, notarized `.dmg`. An unsigned
  build cannot register its helper; it runs only when launched as root, which
  uses the in-process tunnel.
- **Windows:** there is no code-signing certificate, so SmartScreen warns on
  install, and the helper's Authenticode check (`REQUIRE_AUTHENTICODE` in
  `helper/src/peer_windows.rs`) stays off.
- **Linux:** packages are unsigned.

**Updater.** `tauri.conf.json` carries a `plugins.updater` block (endpoint
`releases/latest/download/latest.json`, public key), and the workflow passes
`TAURI_SIGNING_PRIVATE_KEY` / `_PASSWORD`. The app does not include
`tauri-plugin-updater` and the bundle config does not set
`createUpdaterArtifacts`, so releases carry no `latest.json` and installed apps
update by installing the new release. Enabling it means adding the plugin to the
app, setting `bundle.createUpdaterArtifacts`, and generating the key:

```bash
cd clients/desktop
yarn tauri signer generate -w cumulusvpn-updater.key
# prints a PUBLIC key and writes the private key to cumulusvpn-updater.key (gitignored)
```

The public key goes in `plugins.updater.pubkey`; the private key and its
password go in the `TAURI_SIGNING_PRIVATE_KEY` / `_PASSWORD` secrets.

**Release:** bump the versions (below) to the new version, then
`git tag desktop-v<x.y.z> && git push origin desktop-v<x.y.z>`, and publish the
draft once the three legs are green.

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

| Secret                                                                                          | Used by                        | Who provides                    |
| ----------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------- |
| `ANDROID_SIGNING_KEY` / `ANDROID_ALIAS` / `ANDROID_KEY_STORE_PASSWORD` / `ANDROID_KEY_PASSWORD` | Android                        | you (keytool)                   |
| `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`                              | Desktop updater (once enabled) | you (tauri signer)              |
| `APPLE_*` (6)                                                                                   | Desktop macOS notarization     | Apple Developer acct (optional) |
| — (Xcode Cloud)                                                                                 | iOS                            | App Store Connect               |

## Versioning

Bump **every** string below before tagging — the release workflows do not derive
them all, and a miss ships an app that misreports its own version. (Desktop was
tagged `desktop-v1.0.0` while every internal string still said `0.1.0`; that is
the failure this checklist exists to prevent.)

**Mobile** (tag `mobile-v<x.y.z>`):

| File                                      | Field                          | Why it matters                                                                                                                               |
| ----------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `clients/mobile/package.json`             | `version`                      | Babel inlines it as `__APP_VERSION__` → the Settings **About** row. Missing this ships the wrong version _to the user's screen_.             |
| `clients/mobile/android/app/build.gradle` | `versionName` default          | Local/dev builds only — CI overrides from the tag (`-PcvpnVersionName`), and `versionCode` comes from the run number. Keep it honest anyway. |
| `clients/mobile/ios/…/project.pbxproj`    | `MARKETING_VERSION` (×4)       | The version App Store Connect shows. Xcode Cloud builds from the project, not the tag.                                                       |
| `clients/mobile/ios/…/project.pbxproj`    | `CURRENT_PROJECT_VERSION` (×4) | Build number. **Must increase for every TestFlight upload** — a duplicate is rejected even when the marketing version changed.               |

**Desktop** (tag `desktop-v<x.y.z>`):

| File                                          | Field                                                                                   |
| --------------------------------------------- | --------------------------------------------------------------------------------------- |
| `clients/desktop/package.json`                | `version`                                                                               |
| `clients/desktop/src-tauri/tauri.conf.json`   | `version` (the installers and the binary)                                               |
| `clients/desktop/src/components/Settings.tsx` | `APP_VERSION` (the About row)                                                           |
| `clients/desktop/src-tauri/helper/Cargo.toml` | `version` — what `cumulusvpn-helper --version` and `--ping` report (`0.1.0` at `1.4.1`) |

(A future improvement: derive all of these from the tag in CI.)

---

## Web, landing and dashboard

Three **separate** Cloudflare Workers, each with its own `wrangler.jsonc`. **All
three deploy automatically** from git-connected Cloudflare builds on push to
`main` — none is tagged, versioned, or hand-deployed:

| Surface                        | Worker                 | Config                                                                                |
| ------------------------------ | ---------------------- | ------------------------------------------------------------------------------------- |
| `vpn.cumulusvpn.com` (the app) | `cumulusvpn`           | **`wrangler.jsonc` at the repo ROOT** (serves `clients/web/dist` + the `/gw/*` proxy) |
| `cumulusvpn.com` (landing)     | landing worker         | `clients/landing/wrangler.jsonc`                                                      |
| `dashboard.cumulusvpn.com`     | `cumulusvpn-dashboard` | `clients/dashboard/wrangler.jsonc`                                                    |

Note the web app's config is at the **repo root**, not under `clients/web/` —
looking only inside `clients/web/` suggests it has no CD, which is wrong.

Practical consequence: **new countries and a rebuilt signed directory reach web
users automatically** (the app serves `clients/web/public/directory.json`), while
mobile and desktop bundle the directory at build time and need a new release.

To confirm a web deploy landed, grep the served bundle for a string you just
shipped:

```bash
asset=$(curl -s https://vpn.cumulusvpn.com/ | grep -o '/assets/index-[A-Za-z0-9_-]*\.js' | head -1)
curl -s "https://vpn.cumulusvpn.com$asset" | grep -c 'a string from your change'
```

Verified 2026-08-05: split-tunneling UI strings merged to `main` that morning
were live in the served bundle the same day, with no manual step.
