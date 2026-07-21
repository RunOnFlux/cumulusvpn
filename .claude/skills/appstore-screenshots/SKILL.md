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
2. **Connected-state caveat:** packet-tunnel extensions do NOT run on the iOS
   Simulator, so `connect.png` (and any connected-state frame) likely needs a
   **physical iPhone** capture (Xcode → Devices and Simulators, or
   `xcrun devicectl`). Any modern ~19.5:9 iPhone works — the compositor
   rescales the raw into the bezel, so the capture does not have to be
   1320×2868.
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
   | `connect.png` | ConnectScreen, connected (single-hop), city + the honest "Free · 100 KB/s" line visible |
   | `countries.png` | CountryPickerScreen, sorted country list, latency dots visible |
   | `tier.png` | SettingsScreen, free tier — "Limited to 100 KB/s — tap to upgrade" row visible |
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
