---
name: playstore-screenshots
description: Generate Google Play Store screenshots for CumulusVPN — Android emulator captures framed in a Pixel bezel on the brand sky gradient, cyan Menlo kicker + Inter headline. Play-compliant phone size (1080×2160, 2:1).
---

# Play Store Screenshot Compositor (Android)

Generates Google Play phone screenshots for CumulusVPN. Renders at **1080×2160**
(exactly 2:1 — the max ratio Play allows) and seats Android emulator captures
in a **Pixel bezel** (`assets/frames/`, self-rendered, no third-party rights)
on the app's sky gradient — visual parity with the App Store set.

> App Store screenshots use a **separate** skill: `appstore-screenshots`
> (iOS Simulator, official iPhone bezel, Apple sizes). Do not mix the two.

## Capture the raws (Android emulator)

`VpnService` works on the emulator, so connected-state frames CAN be captured
there (unlike the iOS Simulator). Use a release build — no dev chrome (metro
banner, dev menu).

1. Boot a Pixel AVD (Android Studio → Device Manager, or `emulator @<avd>`),
   then install + launch a release build:
   ```bash
   cd clients/mobile
   yarn android --mode release
   ```
2. Clean status bar via demo mode (before any capture):
   ```bash
   adb shell settings put global sysui_demo_allowed 1
   adb shell am broadcast -a com.android.systemui.demo -e command clock -e hhmm 0941
   adb shell am broadcast -a com.android.systemui.demo -e command network -e wifi show -e level 4
   adb shell am broadcast -a com.android.systemui.demo -e command battery -e plugged false -e level 100
   adb shell am broadcast -a com.android.systemui.demo -e command notifications -e visible false
   ```
   When done capturing:
   ```bash
   adb shell am broadcast -a com.android.systemui.demo -e command exit
   ```
3. Capture each raw to `store/assets/screenshots/raw/android/<key>.png` —
   note step 1 left the shell in `clients/mobile`, so return to the repo root
   first:
   ```bash
   cd "$(git rev-parse --show-toplevel)"
   adb exec-out screencap -p > store/assets/screenshots/raw/android/countries.png
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
cd .claude/skills/playstore-screenshots
python3 compositor.py --locale en
python3 compositor.py --only connect --locale en --preview
python3 compositor.py --locale en --dry-run
```

| Flag | Description |
|------|-------------|
| `--locale` | Curated locale (currently `en`) or `all` |
| `--only` | Render only specific screen keys |
| `--raw-dir` | Override raw dir (default `store/assets/screenshots/raw/android/`) |
| `--output-dir` | Override output dir (default `output/`) |
| `--dry-run` | Show copy resolution without rendering |
| `--preview` | Open results in Preview.app (macOS) |

Pipeline check without the app: `python3 tests/smoke_test.py`

## Screens & copy

- Screens: `config/screens.yaml` — connect, countries, tier, multihop (`hero`)
  + brand (`brand`, the no-device closing frame).
- Copy: `config/locales/en.yaml` — identical strings to the App Store skill.
  A new locale is a new curated YAML; there is no auto-translate.

## QC gate (before copying finals to `store/assets/screenshots/android/`)

For every composed frame: (a) headline legible at **25% zoom**; (b) status bar
shows 09:41 demo mode; (c) no dev/debug UI anywhere; (d) copy claims nothing
the frame doesn't show (honesty rule from `store/assets-checklist.md`);
(e) identical layout geometry across frames; (f) exports are RGB with no alpha
(Play rejects alpha PNGs).

## Output

```
output/google/en/phone/NN-key.png   # 1080×2160 (2:1)
```

Copy finals to `store/assets/screenshots/android/` for the Play Console
upload (2–8 phone screenshots; ≥4 at 1080px+ for promotion eligibility).

## Requirements

- Play phone screenshots: PNG/JPEG, no alpha, each side 320–3840px, longer
  side ≤ 2× shorter. Framing is allowed; the Pixel bezel is self-rendered
  (no third-party rights).
- Python 3.12+, Pillow, numpy, PyYAML. Inter Bold is vendored in
  `assets/fonts/`; the kicker uses macOS system Menlo.
