# 14 — App releases (Android · Desktop · iOS)

Signed release pipelines for the native apps, mirroring the ssp-key setup. All are
**tag-triggered** and publish artifacts to a GitHub Release. The gateway image and
the two websites already auto-deploy (see `.github/workflows/README.md`).

| App     | Workflow                          | Trigger tag      | Output                                                               |
| ------- | --------------------------------- | ---------------- | -------------------------------------------------------------------- |
| Android | `android-release.yml`             | `mobile-v*`      | signed **APK + AAB** → GitHub Release                                |
| Desktop | `desktop-release.yml`             | `desktop-v*`     | macOS **Apple Silicon** `.dmg`/`.app` (Intel/Windows/Linux deferred) |
| iOS     | Xcode Cloud (+ `ios/ci_scripts/`) | (Xcode Cloud UI) | TestFlight / App Store                                               |

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

**2b. Windows signing — Azure Artifact Signing** (formerly Trusted Signing).
Publisher: **InFlux Technologies USA LLC**, same as the Mac build. Already set
up: account `zelcoresigningus` (East US), Public Trust profile
`zelcore-public-trust-us`, and the Entra app `cumulusvpn-signing-ci`, which has
only the **Artifact Signing Certificate Profile Signer** role on that account.
GitHub signs in to it with **OIDC** (federated credential for
`repo:RunOnFlux@78997786/cumulusvpn@1303456879:environment:desktop-release`),
so **no client secret exists**. The release job runs in the `desktop-release`
environment for that reason.

Repo variables (set): `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`,
`AZURE_SUBSCRIPTION_ID`, `AZURE_CODE_SIGNING_ENDPOINT`,
`AZURE_CODE_SIGNING_ACCOUNT_NAME`, `AZURE_CERTIFICATE_PROFILE_NAME`.

Tauri's `signCommand` and `scripts/build-helper.mjs` run
`scripts/sign-windows.ps1` on the app, sidecar, helper and both installers; the
verify step requires a Valid, timestamped signature on every installer and every
installed `.exe`/`.dll`. A tag build fails if the variables are missing.

**2c. Linux — signed apt/dnf repository** at `https://pkg.cumulusvpn.com`,
served by **GitHub Pages** from this repo (R2 can't be self-served on the
InFlux Cloudflare account). DNS: `pkg` CNAME → `runonflux.github.io`, DNS only
(not proxied), plus the Pages custom domain `pkg.cumulusvpn.com` with HTTPS
enforced. Linux has no code-signing CA: trust is a CumulusVPN GPG key.
`desktop-linux-repo.yml` runs when a `desktop-v*` release is **published** (not
on the draft). It rebuilds the whole repo from the newest 3 published desktop
releases (stateless), signs it with `scripts/linux-repo.sh`, deploys Pages,
smoke-tests apt + dnf against the live site, and signs a `SHA256SUMS.asc` onto
the release.

Generate the key once and back it up in the password manager:

```bash
gpg --quick-gen-key "CumulusVPN Packages <info@cumulusvpn.com>" rsa4096 sign never
FPR=$(gpg --list-secret-keys --with-colons "info@cumulusvpn.com" | awk -F: '/^fpr/{print $10; exit}')
gh variable set LINUX_GPG_FINGERPRINT --body "$FPR"
gpg --armor --export-secret-keys "$FPR" | gh secret set LINUX_GPG_PRIVATE_KEY
gh secret set LINUX_GPG_PASSPHRASE   # paste the passphrase when prompted
```

The key deliberately **never expires**: users' apt keyrings and dnf key
imports are static copies, so an expiring key would break `apt update`
everywhere (EXPKEYSIG) on the expiry date. The protection is the revocation
certificate gpg writes to `~/.gnupg/openpgp-revocs.d/<FPR>.rev` — store it,
with an export of the secret key, in the password manager. If the key is ever
compromised: import the revocation, publish the revoked key at
`/cumulusvpn.asc`, and rotate to a new key.

User install instructions:

```bash
# Debian / Ubuntu
curl -fsSL https://pkg.cumulusvpn.com/cumulusvpn.asc | sudo gpg --dearmor -o /usr/share/keyrings/cumulusvpn.gpg
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/cumulusvpn.gpg] https://pkg.cumulusvpn.com/deb stable main" \
  | sudo tee /etc/apt/sources.list.d/cumulusvpn.list
sudo apt update && sudo apt install cumulus-vpn

# Fedora / RHEL
sudo curl -fsSL -o /etc/yum.repos.d/cumulusvpn.repo https://pkg.cumulusvpn.com/rpm/cumulusvpn.repo
sudo dnf install cumulus-vpn
```

**3. Release:** `git tag mobile-v1.0.0 && git push origin mobile-v1.0.0` → the
workflow builds the signed APK + AAB and attaches both to a GitHub Release. Upload
the **AAB** to the Play Console. Keep the keystore safe — with **Play App Signing**
Google re-signs, but this upload key is still your identity to Play.

_(Optional)_ auto-upload to Play: add a Play service-account JSON secret and a
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

**2. macOS sign + notarize** (REQUIRED for tag builds — an unsigned `.dmg` is
reported as "damaged" by Gatekeeper, and the privileged helper cannot register
without a Developer ID signature). Everything must come from the US team
**276MY32G8B** (= `APPLE_TEAM_ID` in `src-tauri/helper/src/peer.rs`):

- **Developer ID Application** certificate (only the Account Holder can create
  it; G2 Sub-CA). Export cert + private key as `.p12`.
- **App Store Connect API key** (Users and Access → Integrations → Team Keys,
  role Developer) for notarization.

| Secret                       | Value                                                   |
| ---------------------------- | ------------------------------------------------------- |
| `APPLE_CERTIFICATE`          | `base64 -i cert.p12 \| pbcopy`                          |
| `APPLE_CERTIFICATE_PASSWORD` | the `.p12` export password                              |
| `APPLE_SIGNING_IDENTITY`     | `Developer ID Application: <Company name> (276MY32G8B)` |
| `APPLE_API_KEY`              | the Key ID                                              |
| `APPLE_API_ISSUER`           | the Issuer ID                                           |
| `APPLE_API_KEY_P8`           | the full contents of `AuthKey_<KeyID>.p8`               |

The workflow imports the cert into a throwaway keychain, `scripts/build-helper.mjs`
signs the helper (Tauri does not sign `bundle.macOS.files`), and Tauri signs the
sidecar + app. Tauri does **not** notarize: `scripts/notarize-macos.sh` submits the
`.dmg`, polls Apple with retries (a runner network drop mid-wait failed
desktop-v1.4.2 twice under Tauri's single-shot poll), staples the ticket to the
`.dmg` and `.app`, and replaces the draft release's `.dmg`. It waits up to 5 h,
because a new team's first submissions can stay "In Progress" for hours. A
verify step then checks the team ID, hardened runtime, `spctl` and the stapled
tickets.
A tag build without these secrets fails on purpose. Manual (`workflow_dispatch`)
builds without them still produce an unsigned, test-only build.

**3. Release:** `git tag mobile-v1.0.0 && git push origin mobile-v1.0.0` → the
workflow builds the signed APK + AAB and attaches both to a GitHub Release. Upload
the **AAB** to the Play Console. Keep the keystore safe — with **Play App Signing**
Google re-signs, but this upload key is still your identity to Play.

_(Optional)_ auto-upload to Play: add a Play service-account JSON secret and a
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

**3. Release:** `git tag desktop-v1.0.0 && git push origin desktop-v1.0.0` → builds
the **Apple Silicon** macOS installer and publishes a **draft** GitHub Release.

> **Apple Silicon only (decided):** Intel Macs are dropped (obsolete). The vendored
> `wireguard-go` sidecar covers `aarch64-apple-darwin`, so this build works as-is —
> no cross-compile needed. To add Windows/Linux later, extend
> `clients/desktop/scripts/fetch-wireguard-go.sh` to cross-compile wireguard-go per
> platform and re-add those matrix legs to `desktop-release.yml`.

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

| Secret                                                                                          | Used by                    | Who provides                    |
| ----------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------- |
| `ANDROID_SIGNING_KEY` / `ANDROID_ALIAS` / `ANDROID_KEY_STORE_PASSWORD` / `ANDROID_KEY_PASSWORD` | Android                    | you (keytool)                   |
| `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`                              | Desktop updater            | you (tauri signer)              |
| `APPLE_*` (6)                                                                                   | Desktop macOS notarization | Apple Developer acct (optional) |
| — (Xcode Cloud)                                                                                 | iOS                        | App Store Connect               |

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

| File                                          | Field                                     |
| --------------------------------------------- | ----------------------------------------- |
| `clients/desktop/package.json`                | `version`                                 |
| `clients/desktop/src-tauri/tauri.conf.json`   | `version` (the binary + updater manifest) |
| `clients/desktop/src/components/Settings.tsx` | `APP_VERSION` (the About row)             |

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
