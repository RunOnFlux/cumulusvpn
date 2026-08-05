---
name: appstore-screenshots
description: Generate Apple App Store screenshots for CumulusVPN — iOS captures framed in the official Apple iPhone bezel on the brand sky gradient, cyan Menlo kicker + Inter headline. Exact Apple 6.9"/6.7"/6.5" sizes.
---

# App Store Screenshot Compositor (iOS)

Generates Apple App Store phone screenshots for CumulusVPN. Renders at master
resolution (1320×2868, iPhone 16 Pro Max / 6.9") and exports 6.7" (1290×2796)
and 6.5" (1242×2688). Seats captures in the **official Apple iPhone bezel**
(`assets/frames/`, Apple marketing artwork — sanctioned, rejection-safe
framing) on the app's sky gradient.

> Play Store screenshots use a **separate** skill: `playstore-screenshots`
> (Android emulator, Pixel bezel, Play sizes). Do not mix the two.

## Capture the raws (iOS)

Raws must show real UI with no dev chrome (metro banner, dev menu, inspector)
— use a Release build.

1. Build + install on the simulator:
   ```bash
   cd clients/mobile/ios
   xcodebuild -workspace CumulusVPN.xcworkspace -scheme CumulusVPN \
     -configuration Release \
     -destination 'platform=iOS Simulator,name=iPhone 16 Pro Max' \
     -derivedDataPath build/release-shots build
   xcrun simctl boot "iPhone 16 Pro Max" || true
   xcrun simctl install "iPhone 16 Pro Max" \
     build/release-shots/Build/Products/Release-iphonesimulator/CumulusVPN.app
   xcrun simctl launch "iPhone 16 Pro Max" com.cumulusvpn.app
   ```
2. **Screenshot mode — needed for `connect.png` and `countries.png`.**
   Packet-tunnel extensions do NOT run on the iOS Simulator, so the app can
   never reach `connected` there; and latency is measured live, so the country
   ratings depend on where the capture machine sits (from Asia-Pacific every
   European node reads 300–800 ms and the whole list renders "Good").

   `CVPN_SCREENSHOT=1` swaps both for fixed demo data — see
   `clients/mobile/src/lib/screenshot.ts` for the honesty rules the data has to
   satisfy (representative-not-invented latencies; throughput under the free
   tier's own 100 KB/s cap; no fabricated features).

   Xcode does **not** forward the env var to Metro's build phase, so build the
   bundle separately and drop it into the `.app`:
   ```bash
   cd clients/mobile
   CVPN_SCREENSHOT=1 npx react-native bundle --platform ios --dev false \
     --entry-file index.js --bundle-output /tmp/demo.jsbundle --reset-cache
   APP=ios/build/release-shots/Build/Products/Release-iphonesimulator/CumulusVPN.app
   cp /tmp/demo.jsbundle "$APP/main.jsbundle"
   xcrun simctl install "iPhone 16 Pro Max" "$APP"
   ```
   Then tap Connect — it enters the demo session without the native module.

   **The demo data cannot ship.** `metro.config.js` resolves `./screenshot` to
   `./screenshot.stub` unless `CVPN_SCREENSHOT=1`, so it never enters a normal
   bundle's dependency graph. Guarding the call sites alone is NOT enough (the
   branches die but the module's constants are still bundled — that leak was
   observed). Before any store upload, prove it:
   ```bash
   cd clients/mobile && yarn verify:no-demo-data
   ```

   A **physical iPhone** capture also works and needs no demo mode
   (`xcrun devicectl`, or Xcode → Devices and Simulators). Any modern ~19.5:9
   iPhone works — the compositor rescales the raw into the bezel, so the capture
   does not have to be 1320×2868. Note you cannot force the 9:41 status bar on a
   real device the way `simctl status_bar` does on a Simulator.
3. Canonical status bar before any Simulator capture:
   ```bash
   xcrun simctl status_bar "iPhone 16 Pro Max" override \
     --time 9:41 --batteryLevel 100 --batteryState charged \
     --dataNetwork wifi --wifiBars 3
   ```
4. Capture each raw to `store/assets/screenshots/raw/ios/<key>.png` — note
   step 1 left the shell in `clients/mobile/ios`, so return to the repo root
   first:
   ```bash
   cd "$(git rev-parse --show-toplevel)"
   xcrun simctl io "iPhone 16 Pro Max" screenshot \
     store/assets/screenshots/raw/ios/countries.png
   ```

   | Raw | View + state |
   |-----|--------------|
   | `connect.png` | ConnectScreen, connected (single-hop) — physical device needed; simulator fallback is the "TAP TO CONNECT" state |
   | `countries.png` | CountryPickerScreen, sorted country list, latency dots visible |
   | `privacy.png` | DisclosureScreen ("What data we collect") — replaced the old Settings/tier frame after Apple's 2.3.7 rejection ("free" in screenshot copy = price reference) |
   | `multihop.png` | ConnectScreen, multi-hop route-style selector open, tradeoff copy visible |

   Frame 5 (`brand`) needs no raw — it renders from `assets/brand-glyph.png`
   + copy alone.

## Generate

```bash
cd .claude/skills/appstore-screenshots
python3 compositor.py --locale en
python3 compositor.py --only connect --locale en --preview
python3 compositor.py --locale en --dry-run
```

| Flag | Description |
|------|-------------|
| `--locale` | Curated locale (currently `en`) or `all` |
| `--only` | Render only specific screen keys |
| `--raw-dir` | Override raw dir (default `store/assets/screenshots/raw/ios/`) |
| `--output-dir` | Override output dir (default `output/`) |
| `--dry-run` | Show copy resolution without rendering |
| `--preview` | Open results in Preview.app (macOS) |

Pipeline check without the app: `python3 tests/smoke_test.py`

## Screens & copy

- Screens: `config/screens.yaml` — connect, countries, tier, multihop (`hero`)
  + brand (`brand`, the no-device closing frame).
- Copy: `config/locales/en.yaml`. Label = kicker caps (1-2 words); headline =
  one benefit claim, `\n` is a hard line break. A new locale is a new curated
  YAML — there is no auto-translate.

## QC gate (before copying finals to `store/assets/screenshots/ios/`)

For every composed frame: (a) headline legible at **25% zoom**; (b) status bar
shows 9:41; (c) no dev/debug UI anywhere; (d) copy claims nothing the frame
doesn't show (honesty rule from `store/assets-checklist.md`); (e) identical
layout geometry across frames; (f) exports are RGB with no alpha.

## Output

```
output/apple/en/iphone-6.9/NN-key.png   # 1320×2868 (master slot)
output/apple/en/iphone-6.7/NN-key.png   # 1290×2796 (also fits the 6.9" slot)
output/apple/en/iphone-6.5/NN-key.png   # 1242×2688 (ASC's separate 6.5" slot)
```

Copy finals to `store/assets/screenshots/ios/` for the App Store Connect
upload. ASC's 6.5" slot is NOT filled by the 6.9" set — upload `iphone-6.5`
there.

## Requirements

- Screenshots must be exact device pixel dimensions and accurately depict the
  app (App Store Review 2.3.3 / 2.3.10).
- Python 3.12+, Pillow, numpy, PyYAML. Inter Bold is vendored in
  `assets/fonts/`; the kicker uses macOS system Menlo.
