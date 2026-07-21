# Store screenshot skills: port from to-brief → CumulusVPN

**Date:** 2026-07-21
**Status:** Approved (design), pending implementation

## Goal

Bring the proven App Store / Play Store screenshot compositor skills from the
`to-brief` repo (`/Volumes/MAC_EXTERNAL/repos/to-brief/.claude/skills/`) into
this repo as two CumulusVPN-branded skills, ready to turn raw device captures
into upload-ready store screenshot sets. This retires the one REQUIRED
**[todo]** left in `store/assets-checklist.md` §3 (screenshots) down to a
capture-and-run exercise.

**Success criteria**

- `.claude/skills/appstore-screenshots/` and `.claude/skills/playstore-screenshots/`
  exist in this repo, self-contained (no reference to to-brief paths, brands,
  accounts, or locales).
- `python3 compositor.py --locale en` in each skill renders the 5-frame
  storyboard from raws in `store/assets/screenshots/raw/{ios,android}/` to
  exact store sizes (Apple 1320×2868 master + 1290×2796 + 1242×2688;
  Google 1080×2160, no alpha).
- A synthetic-raw smoke test (solid-colour PNG at capture size) renders
  end-to-end without the real app, proving the pipeline before any device work.
- SKILL.md in each skill carries a CumulusVPN-specific capture recipe and QC
  gate; no captures are produced in this project (deliverable = skills only).

**Explicitly out of scope:** building/running the RN app, capturing real
screenshots, uploading to the stores, tablet/Chromebook sets, feature
graphic / icon work (already **[done]** in the checklist), localization beyond
English, the `playstore-assets` doc-skill.

## Decisions made

| Decision | Choice |
|---|---|
| Scope | Port both compositor skills; skip `playstore-assets` (redundant with checklist) |
| Topology | **Approach 2 — faithful two-skill port.** Two sibling skills, duplicated `lib/`, accepted deliberately: each store has its own considerations; coupling them is what the source repo tried and drifted on |
| Locales | English only (`config/locales/en.yaml`); Gemini auto-translate machinery removed |
| Deliverable | Skills only; capture + generation is a follow-up run |
| Storyboard | The 5 frames already designed in `store/assets-checklist.md` §3 |
| Commits | Plain commit messages as the user's git identity — no AI co-author trailers |

## Skill layout (both skills, same shape)

```
.claude/skills/appstore-screenshots/          .claude/skills/playstore-screenshots/
  SKILL.md                                      SKILL.md
  compositor.py                                 compositor.py
  .gitignore            (output/, __pycache__/, *.pyc)
  config/
    devices.yaml        Apple: iphone-6.9 1320×2868 (master),   Google: phone
                        iphone-6.7 1290×2796,                   1080×2160 (2:1 max
                        iphone-6.5 1242×2688                    Play allows)
    screens.yaml        5 frames (below), all `hero` except `brand`
    locales/en.yaml     label + headline per frame (schema unchanged from source)
  assets/frames/        official Apple iPhone bezel             Pixel bezel
                        + geometry.json (copied verbatim)       + geometry.json
  assets/fonts/         Inter-Bold.ttf (vendored — converted once from
                        clients/landing/public/fonts/inter-700.woff2 via fonttools)
  lib/
    __init__.py, config.py, copy_resolver.py, exporter.py,
    fonts.py, frame.py, layouts.py, retouch.py
```

CLI is unchanged from the source: `--locale`, `--only`, `--raw-dir`,
`--output-dir`, `--dry-run`, `--preview` (macOS `open`).

**Paths.** Default raw dir: `store/assets/screenshots/raw/ios/` (appstore
skill) and `store/assets/screenshots/raw/android/` (playstore skill). Output
renders to `output/` inside each skill (git-ignored); SKILL.md instructs
copying finals to `store/assets/screenshots/{ios,android}/` — the folders the
assets checklist already designates.

## Engine deltas from the source (applied identically in both skills)

- **`copy_resolver.py`** — English-only: loads curated locale YAMLs from
  `config/locales/`; the Gemini translate path is deleted. Requesting a locale
  with no curated file is a clear error naming the file to create.
- **`retouch.py`** — becomes a documented no-op hook (`apply_retouch(key, img)
  → img`) kept so `compositor.py`'s call-site and the extension point survive;
  all ToBrief pixel-coordinate retouches deleted.
- **`fonts.py`** — `FONT_PATHS` resolves from the skill's own `assets/fonts/`
  plus macOS system Menlo (`/System/Library/Fonts/Menlo.ttc`). Roles:
  `headline`/`wordmark`/`fallback` → Inter Bold (vendored);
  `label`/`mono` → Menlo Bold (system). `MASTER_SIZES` numbers unchanged.
  The node_modules/pnpm glob resolution is deleted.
- **`layouts.py`** — rebrand + one new layout (next section).
- **`config.py`, `exporter.py`, `frame.py`** — unchanged apart from constants
  (device tables per store) and docstrings. Exporter behaviour retained:
  LANCZOS downscale from master, Play export flattened RGB (no alpha).

## Branding (hero layout rebrand)

- **Canvas:** vertical gradient through the app's own `skyGradient` tokens
  `#10203A → #1D3A63 → #2F6F9E` (replaces flat cream). Rendered with a numpy
  linear interpolation — numpy is already a dependency of the source engine.
- **Kicker:** tracked Menlo Bold caps in cyan `#34E4DA` (the landing's eyebrow
  style; tracking constant unchanged).
- **Headline:** Inter Bold, ink `#EAF3FA`, same auto-shrink/hard-break logic.
- **Device shadow:** `paste_with_shadow` retained as-is (reads as subtle depth
  on the dark canvas).
- Layout geometry fractions (caption top, side padding, device width, bottom
  bleed) copied verbatim.

## Storyboard & copy

`screens.yaml` (same 5 keys, same order, both stores):

| # | key | layout | Capture (view + state) |
|---|-----|--------|------------------------|
| 1 | `connect` | hero | ConnectScreen, connected state (single-hop), city + the honest "Free · 100 KB/s" line visible |
| 2 | `countries` | hero | CountryPickerScreen, sorted country list, latency dots visible |
| 3 | `tier` | hero | SettingsScreen, free tier — "Limited to 100 KB/s — tap to upgrade" row visible (screen variety over repeating ConnectScreen) |
| 4 | `multihop` | hero | ConnectScreen with the multi-hop route-style selector (`MULTIHOP_STYLES`) open, tradeoff copy visible |
| 5 | `brand` | brand | No capture — brand frame |

- `en.yaml` schema is the source schema (`screens.<key>.label` / `.headline`,
  `\n` = hard line break). Final caption strings are written at planning time
  and reviewed in the plan; intent per checklist: benefit-per-frame, honest
  copy, no prices beyond the public free-tier fact.
- **New `brand` layout** (~30 lines in `layouts.py`): kicker + headline
  centered on the sky gradient with the CumulusVPN glyph
  (`store/assets/icon/play-icon-512.png`) above — no device bezel. Only
  `brand`-layout screens may omit a raw file; `hero` screens without a raw are
  skipped with a warning (source behaviour).

## Capture recipes (SKILL.md content, not executed in this project)

**iOS (appstore-screenshots):** Release-configuration build via `xcodebuild
-workspace CumulusVPN.xcworkspace -scheme CumulusVPN` from
`clients/mobile/ios`, installed on an iPhone 16 Pro Max simulator;
`simctl status_bar override` (9:41, wifi 3 bars, battery 100); capture via
`simctl io screenshot`. **Caveat recorded in SKILL.md:** packet-tunnel
extensions do not run on the Simulator, so connected-state frames likely need
a physical iPhone capture (any modern ~19.5:9 iPhone works — the compositor
rescales the raw into the bezel, so exact capture resolution is not required
for framing; only the canvas export sizes are exact).

**Android (playstore-screenshots):** Pixel AVD (`VpnService` works on the
emulator); clean status bar via demo mode (`adb shell settings put global
sysui_demo_allowed 1` + `adb shell am broadcast -a
com.android.systemui.demo …` for clock 0941/wifi/battery — an upgrade over
the source skill, which shipped the default status bar); capture via
`adb exec-out screencap -p`.

## QC gate (SKILL.md, both skills)

For every composed frame before copying to `store/assets/screenshots/`:
(a) headline legible at 25% zoom; (b) canonical status bar (9:41 / 09:41);
(c) no dev/debug UI (metro banner, dev menu, RN inspector); (d) copy matches
what the frame actually shows (honesty rule from the checklist);
(e) identical layout geometry across frames; (f) Play exports carry no alpha
channel.

## Testing / verification (implementation-time)

- Synthetic-raw smoke test per skill: generate a solid-colour PNG at a
  plausible capture size (1320×2868 / 1080×2400), run
  `python3 compositor.py --locale en`, assert every configured export exists
  at exact dimensions, Play export has no alpha, `brand` frame renders with no
  raw present, `--dry-run` and `--only` behave.
- `python3 -c "import lib.…"` sanity + `--dry-run` as the cheap first check.
- Verify vendored `Inter-Bold.ttf` loads in Pillow and covers basic Latin.
- No repo-wide pipeline impact expected (skills are not part of `yarn check`);
  confirm nothing in CI globs `.claude/`.

## Rollback

The skills are additive (new directories + two lines in `.gitignore` scope if
needed). Reverting the commits removes them cleanly; nothing else references
them.
