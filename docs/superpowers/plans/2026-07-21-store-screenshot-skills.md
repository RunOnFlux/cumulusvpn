# Store Screenshot Skills Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the to-brief App Store / Play Store screenshot compositor skills into this repo as two CumulusVPN-branded skills (`.claude/skills/appstore-screenshots/`, `.claude/skills/playstore-screenshots/`), per `docs/superpowers/specs/2026-07-21-store-screenshot-skills-design.md`.

**Architecture:** Each skill is a self-contained Python/Pillow compositor: config-driven screens + copy (YAML), a bezel-seating frame module, a layout renderer (sky-gradient `hero` + new no-device `brand`), and a multi-size exporter. The two skills are deliberate near-duplicates (approved Approach 2 — per-store independence over DRY). No app builds or captures happen in this project; a synthetic-raw smoke test proves each pipeline end-to-end.

**Tech Stack:** Python 3.12, Pillow 12.x, numpy, PyYAML (all present system-wide on this machine); fonttools (one-time, for woff2→ttf conversion); source material read from `/Volumes/MAC_EXTERNAL/repos/to-brief/.claude/skills/`.

## Global Constraints

- Skills live at `.claude/skills/appstore-screenshots/` and `.claude/skills/playstore-screenshots/`; each is self-contained — committed content must not reference to-brief paths, brand, accounts, or locales.
- English only: `config/locales/en.yaml` per skill, with the exact copy strings from Task 1 Step 5 (identical file in both skills). No Gemini/translate machinery.
- Brand colors, exact: sky gradient stops `#10203A → #1D3A63 → #2F6F9E` = `(16,32,58) (29,58,99) (47,111,158)`; kicker cyan `#34E4DA` = `(52,228,218)`; headline ink `#EAF3FA` = `(234,243,250)`.
- Fonts: headline = vendored `assets/fonts/Inter-Bold.ttf` (converted from `clients/landing/public/fonts/inter-700.woff2`); kicker = system Menlo Bold, `/System/Library/Fonts/Menlo.ttc` **index 1**.
- Export sizes, exact: Apple `iphone-6.9` 1320×2868 (master), `iphone-6.7` 1290×2796, `iphone-6.5` 1242×2688; Google `phone` 1080×2160 (master). All exports RGB, no alpha.
- Storyboard keys/order (both skills): `connect`(1) `countries`(2) `tier`(3) `multihop`(4) → layout `hero`; `brand`(5) → layout `brand` (renders with no raw file).
- Default raw dirs: `store/assets/screenshots/raw/ios/` (appstore skill), `store/assets/screenshots/raw/android/` (playstore skill). Finals are copied by hand to `store/assets/screenshots/{ios,android}/` (documented in SKILL.md, not automated).
- **Commits: plain messages authored as the user's git identity. NO `Co-Authored-By`, NO `Claude-Session`, NO AI-attribution trailers of any kind.**
- Do not push until the final task. If `git push` hits transient sandbox network errors ("can't assign requested address"), retry up to 5 times with `sleep 5` between attempts.
- Frame/bezel assets are copied from these exact source paths (small files, committed):
  - `/Volumes/MAC_EXTERNAL/repos/to-brief/.claude/skills/appstore-screenshots/assets/frames/iphone-portrait.png` (+ its `geometry.json`)
  - `/Volumes/MAC_EXTERNAL/repos/to-brief/.claude/skills/playstore-screenshots/assets/frames/pixel-portrait.png` (+ its `geometry.json`)
- Never copy the source skills' `output/`, `__pycache__/`, `.DS_Store`, or `iphone16promax-natural-portrait.png` / `_preview.png` (stale extras).

## File Structure

```
.claude/skills/appstore-screenshots/
  SKILL.md                    # Task 2
  compositor.py               # Task 1 (full rewrite of CLI wiring, STORE="apple")
  .gitignore                  # Task 1
  tests/smoke_test.py         # Task 1 (written FIRST)
  config/devices.yaml         # Task 1 (Apple sizes)
  config/screens.yaml         # Task 1 (5-frame storyboard)
  config/locales/en.yaml      # Task 1 (final copy strings)
  assets/frames/iphone-portrait.png + geometry.json   # Task 1 (copied)
  assets/brand-glyph.png      # Task 1 (copy of store/assets/icon/play-icon-512.png)
  assets/fonts/Inter-Bold.ttf # Task 1 (converted from landing woff2)
  lib/__init__.py             # Task 1 (copied, empty)
  lib/config.py               # Task 1 (copied + VALID_LAYOUTS edit)
  lib/exporter.py             # Task 1 (copied + flatten-colour edit)
  lib/frame.py                # Task 1 (copied verbatim — it IS the Apple bezel)
  lib/fonts.py                # Task 1 (full rewrite)
  lib/copy_resolver.py        # Task 1 (full rewrite, English-only)
  lib/retouch.py              # Task 1 (full rewrite, no-op hook)
  lib/layouts.py              # Task 1 (full rewrite: sky rebrand + brand layout)

.claude/skills/playstore-screenshots/   # Tasks 3–4, same shape:
  … identical lib/config/tests apart from: devices.yaml (google), Pixel frame
  assets, compositor.py STORE="google" + android raw dir, frame.py generic
  docstring, smoke test Play sizes, its own SKILL.md
```

No existing repo files are modified. Nothing in `.github/workflows/` globs `.claude/` (verified in Task 5).

---

### Task 1: App Store skill — engine, assets, configs, smoke test

**Files:**
- Create: everything under `.claude/skills/appstore-screenshots/` except `SKILL.md` (see File Structure)
- Test: `.claude/skills/appstore-screenshots/tests/smoke_test.py`

**Interfaces:**
- Consumes: source files under `/Volumes/MAC_EXTERNAL/repos/to-brief/.claude/skills/appstore-screenshots/` (read-only), `clients/landing/public/fonts/inter-700.woff2`, `store/assets/icon/play-icon-512.png`.
- Produces (relied on by Tasks 2–3): CLI `python3 compositor.py --locale en [--only KEY…] [--raw-dir D] [--output-dir D] [--dry-run] [--preview] [--layout hero|brand]`; output tree `output/apple/en/{iphone-6.9,iphone-6.7,iphone-6.5}/NN-key.png` + `output/metadata.json`; lib API `render_screenshot(layout, screenshot|None, copy, w, h)`, `resolve_copy(screen_key, locale, screenshot_path=None) -> ScreenCopy`, `apply_retouch(screen_key, img) -> img`, `load_font(role, size=None)`.

- [ ] **Step 1: Write the failing smoke test**

Create `.claude/skills/appstore-screenshots/tests/smoke_test.py`:

```python
#!/usr/bin/env python3
"""Synthetic-raw smoke test: renders the full storyboard without the app.

Creates solid-colour raws at capture size, runs the compositor, and asserts
every configured export exists at exact store dimensions with no alpha. The
`brand` frame must render with no raw file present; `--dry-run` must render
nothing.
"""

import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

SKILL_DIR = Path(__file__).resolve().parent.parent
RAW_SIZE = (1320, 2868)  # iPhone 16 Pro Max native capture
EXPECTED = [
    ("apple/en/iphone-6.9", (1320, 2868)),
    ("apple/en/iphone-6.7", (1290, 2796)),
    ("apple/en/iphone-6.5", (1242, 2688)),
]
FRAMES = ["01-connect.png", "02-countries.png", "03-tier.png",
          "04-multihop.png", "05-brand.png"]


def run_compositor(*extra: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SKILL_DIR / "compositor.py"), "--locale", "en", *extra],
        capture_output=True, text=True,
    )


def main() -> None:
    tmp = Path(tempfile.mkdtemp(prefix="shots-smoke-"))
    raw_dir = tmp / "raw"
    out_dir = tmp / "out"
    raw_dir.mkdir()
    # brand.png is deliberately absent — the brand layout needs no raw.
    for name in ("connect.png", "countries.png", "tier.png", "multihop.png"):
        Image.new("RGB", RAW_SIZE, (16, 32, 58)).save(raw_dir / name)

    result = run_compositor("--raw-dir", str(raw_dir), "--output-dir", str(out_dir))
    sys.stdout.write(result.stdout)
    sys.stderr.write(result.stderr)
    assert result.returncode == 0, f"compositor exited {result.returncode}"

    for subdir, size in EXPECTED:
        device_dir = out_dir / subdir
        files = sorted(p.name for p in device_dir.glob("*.png"))
        assert files == FRAMES, f"{subdir}: {files}"
        for p in device_dir.glob("*.png"):
            img = Image.open(p)
            assert img.size == size, f"{p}: {img.size} != {size}"
            assert img.mode == "RGB", f"{p}: mode {img.mode}"
    assert (out_dir / "metadata.json").exists(), "metadata.json missing"

    dry = run_compositor("--raw-dir", str(raw_dir),
                         "--output-dir", str(tmp / "dry"), "--dry-run")
    assert dry.returncode == 0, "dry-run failed"
    assert not (tmp / "dry").exists(), "dry-run must not render"

    print("SMOKE TEST PASS")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Volumes/MAC_EXTERNAL/repos/cumulusvpn/.claude/skills/appstore-screenshots && python3 tests/smoke_test.py`
Expected: FAIL — `AssertionError: compositor exited 2` (compositor.py does not exist yet; stderr shows "No such file or directory").

- [ ] **Step 3: Copy the unchanged engine files, frames, and brand glyph**

```bash
cd /Volumes/MAC_EXTERNAL/repos/cumulusvpn
SRC=/Volumes/MAC_EXTERNAL/repos/to-brief/.claude/skills/appstore-screenshots
DST=.claude/skills/appstore-screenshots
mkdir -p "$DST/lib" "$DST/config/locales" "$DST/assets/frames" "$DST/assets/fonts" "$DST/tests"
cp "$SRC/lib/__init__.py" "$SRC/lib/config.py" "$SRC/lib/exporter.py" "$SRC/lib/frame.py" "$DST/lib/"
cp "$SRC/assets/frames/iphone-portrait.png" "$SRC/assets/frames/geometry.json" "$DST/assets/frames/"
cp store/assets/icon/play-icon-512.png "$DST/assets/brand-glyph.png"
```

Create `.claude/skills/appstore-screenshots/.gitignore`:

```
output/
__pycache__/
lib/__pycache__/
.DS_Store
```

- [ ] **Step 4: Apply the two engine edits to the copied files**

In `.claude/skills/appstore-screenshots/lib/config.py`, change:

```python
VALID_LAYOUTS = {"hero"}
```
to:
```python
VALID_LAYOUTS = {"hero", "brand"}
```

In `.claude/skills/appstore-screenshots/lib/exporter.py`, change:

```python
        # Convert to RGB (no alpha — store requirement)
        if export_img.mode == "RGBA":
            rgb = Image.new("RGB", export_img.size, (245, 245, 240))
```
to:
```python
        # Convert to RGB (no alpha — store requirement); flatten onto sky top
        if export_img.mode == "RGBA":
            rgb = Image.new("RGB", export_img.size, (16, 32, 58))
```

Also in `exporter.py`, update the module docstring's first line from
`"""Multi-size export for Apple App Store and Google Play Store.` to
`"""Multi-size export for the store screenshot compositor.` (the sentence about
1320x2868 master + scaling stays). `lib/frame.py` is kept verbatim — this skill
really does use the official Apple bezel it documents.

- [ ] **Step 5: Write the config files**

`.claude/skills/appstore-screenshots/config/devices.yaml`:

```yaml
# All three iPhone slots App Store Connect can present are covered:
#   6.9" (1320×2868, master)  — the required base size
#   6.7" (1290×2796)          — accepted by the 6.9" slot
#   6.5" (1242×2688)          — ASC exposes a SEPARATE 6.5" slot that the 6.9"
#                               export does NOT fill
# All three share ~19.5:9; the master downscales via LANCZOS with <0.4% aspect
# delta. Play Store devices live in the separate playstore-screenshots skill.
stores:
  apple:
    - name: iphone-6.9
      width: 1320
      height: 2868
      master: true
    - name: iphone-6.7
      width: 1290
      height: 2796
    - name: iphone-6.5
      width: 1242
      height: 2688
```

`.claude/skills/appstore-screenshots/config/screens.yaml`:

```yaml
# 5-frame storyboard from store/assets-checklist.md §3.
# Frames 1-4 are real captures (hero layout); frame 5 is the no-device brand
# closer and needs no raw file.
screens:
  - key: connect
    raw_filename: connect.png
    layout: hero
    order: 1
  - key: countries
    raw_filename: countries.png
    layout: hero
    order: 2
  - key: tier
    raw_filename: tier.png
    layout: hero
    order: 3
  - key: multihop
    raw_filename: multihop.png
    layout: hero
    order: 4
  - key: brand
    raw_filename: brand.png
    layout: brand
    order: 5
```

`.claude/skills/appstore-screenshots/config/locales/en.yaml`:

```yaml
locale: en
curated: true
# Kicker (label) = ALL CAPS, 1-2 words. Headline = one benefit claim, 3-6
# words, `\n` is a hard line break. Honesty rule: nothing a frame doesn't show.
screens:
  connect:
    label: "CONNECT"
    headline: "One tap.\nEncrypted."
  countries:
    label: "COUNTRIES"
    headline: "Pick a country.\nSee the latency."
  tier:
    label: "FREE TIER"
    headline: "Free to use.\nHonest limits."
  multihop:
    label: "MULTI-HOP"
    headline: "Two hops when\none isn't enough."
  brand:
    label: "NO ACCOUNT"
    headline: "No logs.\nPowered by Flux."
```

- [ ] **Step 6: Vendor Inter Bold from the landing woff2**

```bash
cd /Volumes/MAC_EXTERNAL/repos/cumulusvpn
python3 -m pip install --user --quiet fonttools
python3 - <<'EOF'
from fontTools.ttLib import TTFont
dst = ".claude/skills/appstore-screenshots/assets/fonts/Inter-Bold.ttf"
f = TTFont("clients/landing/public/fonts/inter-700.woff2")
f.flavor = None
f.save(dst)
cmap = TTFont(dst).getBestCmap()
needed = set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,'-")
missing = sorted(c for c in needed if ord(c) not in cmap)
assert not missing, f"landing woff2 is subset; missing {missing}"
print("Inter-Bold.ttf OK -", len(cmap), "cmap entries")
EOF
```

Expected: `Inter-Bold.ttf OK - <n> cmap entries`. If the assert fails (subset
font), STOP and report BLOCKED — the spec assumed the landing woff2 carries
full basic Latin.

- [ ] **Step 7: Write `lib/fonts.py` (full rewrite)**

```python
"""Font resolution for the CumulusVPN store screenshot compositor.

Headline: Inter Bold, vendored in the skill's assets/fonts/ (converted once
from clients/landing/public/fonts/inter-700.woff2). Kicker: Menlo Bold from
the macOS system TTC — the app's own mono face (clients/mobile/src/theme/tokens.ts).
"""

import sys
from pathlib import Path
from typing import Optional

from PIL import ImageFont

FONTS_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"
MENLO_TTC = Path("/System/Library/Fonts/Menlo.ttc")
MENLO_BOLD_INDEX = 1  # TTC faces: 0 Regular, 1 Bold, 2 Italic, 3 Bold Italic

FONT_ROLES = {
    "headline": "inter-bold",
    "label": "menlo-bold",
    "fallback": "inter-bold",
}

# Default sizes at the skill's master resolution.
MASTER_SIZES = {
    "headline": 96,
    "label": 40,
}


def load_font(role: str, size: Optional[int] = None) -> ImageFont.FreeTypeFont:
    """Load a font by role (headline, label). Falls back to Inter Bold, then
    Pillow's default bitmap font."""
    size = size or MASTER_SIZES.get(role, 36)
    key = FONT_ROLES.get(role, "fallback")
    if key == "menlo-bold":
        if MENLO_TTC.exists():
            return ImageFont.truetype(str(MENLO_TTC), size, index=MENLO_BOLD_INDEX)
        print("WARNING: system Menlo not found, kicker falls back to Inter Bold",
              file=sys.stderr)
    inter = FONTS_DIR / "Inter-Bold.ttf"
    if inter.exists():
        return ImageFont.truetype(str(inter), size)
    print(f"WARNING: no fonts found for role '{role}', using Pillow default",
          file=sys.stderr)
    return ImageFont.load_default()
```

- [ ] **Step 8: Write `lib/copy_resolver.py` (full rewrite, English-only)**

```python
"""Copy resolution from curated locale YAMLs.

The source skill's auto-translate fallbacks were removed with the multi-locale
machinery: a locale renders only if config/locales/<locale>.yaml exists and
covers the screen key. Anything else is a hard, named error — never silent
fallback copy.
"""

from pathlib import Path
from typing import Optional

from .config import ScreenCopy, load_locale


def resolve_copy(
    screen_key: str,
    locale: str,
    screenshot_path: Optional[Path] = None,
) -> ScreenCopy:
    """Resolve copy for a screen from the curated locale file."""
    locale_config = load_locale(locale)
    if locale_config is None:
        raise SystemExit(
            f"ERROR: no curated copy for locale '{locale}' — "
            f"create config/locales/{locale}.yaml"
        )
    if screen_key not in locale_config.screens:
        raise SystemExit(
            f"ERROR: screen '{screen_key}' missing from config/locales/{locale}.yaml"
        )
    return locale_config.screens[screen_key]
```

(`screenshot_path` stays in the signature so the compositor call-site matches
the source engine's shape.)

- [ ] **Step 9: Write `lib/retouch.py` (full rewrite, no-op hook)**

```python
"""Marketing retouch hook — intentionally empty for CumulusVPN.

The source engine edited brand-specific pixels here. CumulusVPN captures ship
untouched; the hook survives so compositor.py keeps one extension point should
a capture ever need a deterministic, marketing-only edit. Register with
`_RETOUCHERS["<screen key>"] = fn` where fn(img) -> img.
"""

from PIL import Image

_RETOUCHERS: dict = {}


def apply_retouch(screen_key: str, img: Image.Image) -> Image.Image:
    """Apply the screen's registered retouch, if any."""
    fn = _RETOUCHERS.get(screen_key)
    return fn(img) if fn else img
```

- [ ] **Step 10: Write `lib/layouts.py` (full rewrite: sky rebrand + brand layout)**

```python
"""Layout renderers for the CumulusVPN store screenshot compositor.

Two layouts on the brand "sky" gradient (tokens from
clients/mobile/src/theme/tokens.ts):

- `hero`: tracked cyan Menlo kicker + Inter Bold headline at the top, framed
  device large below, bleeding slightly off the bottom edge.
- `brand`: no device — the CumulusVPN glyph above kicker + headline. Used for
  the closing "no account / no logs" frame.
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from .config import ScreenCopy
from .fonts import load_font, MASTER_SIZES
from .frame import render_framed_device, paste_with_shadow

# Brand colors (clients/mobile/src/theme/tokens.ts)
INK = (234, 243, 250)   # #EAF3FA
CYAN = (52, 228, 218)   # #34E4DA
SKY_STOPS = ((16, 32, 58), (29, 58, 99), (47, 111, 158))  # #10203A → #1D3A63 → #2F6F9E

BRAND_GLYPH = Path(__file__).resolve().parent.parent / "assets" / "brand-glyph.png"

# Hero layout tuning (fractions of canvas unless noted)
LABEL_TRACKING = 8   # px between kicker glyphs at master — the eyebrow style
LABEL_GAP = 30       # px between kicker and headline at master
CAPTION_TOP = 0.060
SIDE_PADDING = 0.090
DEVICE_WIDTH = 0.85
BOTTOM_BLEED = 0.05
MIN_CAPTION_GAP = 0.05

# Brand layout tuning (fractions of canvas)
GLYPH_TOP = 0.30
GLYPH_WIDTH = 0.28
GLYPH_TEXT_GAP = 0.045


def _sky_canvas(width: int, height: int) -> Image.Image:
    """Vertical gradient through the app's sky tokens, top → bottom."""
    ys = np.linspace(0.0, 1.0, height)
    pos = np.linspace(0.0, 1.0, len(SKY_STOPS))
    channels = [np.interp(ys, pos, [stop[i] for stop in SKY_STOPS]) for i in range(3)]
    grad = np.stack(channels, axis=-1).round().astype(np.uint8)   # (height, 3)
    arr = np.repeat(grad[:, np.newaxis, :], width, axis=1)        # (height, width, 3)
    return Image.fromarray(arr, "RGB").convert("RGBA")


def _measure_text(draw: ImageDraw.ImageDraw, text: str, font) -> tuple[int, int]:
    bbox = draw.textbbox((0, 0), text, font=font)
    return bbox[2] - bbox[0], bbox[3] - bbox[1]


def _draw_text_block(
    draw: ImageDraw.ImageDraw,
    copy: ScreenCopy,
    center_x: int,
    start_y: int,
    max_width: int,
) -> int:
    """Draw the cyan tracked kicker + ink headline. Returns Y after the last line."""
    font_label = load_font("label", MASTER_SIZES["label"])

    y = start_y

    # Tracked mono kicker — mirrors the landing's letter-spaced eyebrow labels.
    adv = [draw.textlength(ch, font=font_label) + LABEL_TRACKING for ch in copy.label]
    label_w = round(sum(adv) - LABEL_TRACKING)
    _, label_h = _measure_text(draw, copy.label, font_label)
    x = center_x - label_w // 2
    for ch, a in zip(copy.label, adv):
        draw.text((x, y), ch, fill=CYAN, font=font_label)
        x += a
    y += label_h + LABEL_GAP

    # Honor explicit `\n` as HARD breaks; auto-shrink just enough that every
    # line fits max_width (never re-wrap → no orphan words).
    segments = copy.headline.split("\n")
    hsize = MASTER_SIZES["headline"]
    while hsize > 60:
        font_headline = load_font("headline", hsize)
        if max(_measure_text(draw, s, font_headline)[0] for s in segments) <= max_width:
            break
        hsize -= 2
    font_headline = load_font("headline", hsize)

    line_advance = round(hsize * 1.08)
    for seg in segments:
        lw, _ = _measure_text(draw, seg, font_headline)
        draw.text((center_x - lw // 2, y), seg, fill=INK, font=font_headline, anchor="la")
        y += line_advance

    return y - line_advance + hsize


def render_hero(
    screenshot: Image.Image,
    copy: ScreenCopy,
    canvas_width: int,
    canvas_height: int,
) -> Image.Image:
    canvas = _sky_canvas(canvas_width, canvas_height)
    draw = ImageDraw.Draw(canvas)

    side = round(canvas_width * SIDE_PADDING)
    text_bottom = _draw_text_block(
        draw, copy,
        center_x=canvas_width // 2,
        start_y=round(canvas_height * CAPTION_TOP),
        max_width=canvas_width - 2 * side,
    )

    device_w = round(canvas_width * DEVICE_WIDTH)
    device = render_framed_device(screenshot, device_w)
    dw, dh = device.size
    dx = (canvas_width - dw) // 2

    bleed = round(canvas_height * BOTTOM_BLEED)
    dy = canvas_height + bleed - dh
    min_dy = text_bottom + round(canvas_height * MIN_CAPTION_GAP)
    if dy < min_dy:
        dy = min_dy

    paste_with_shadow(canvas, device, dx, dy)
    return canvas


def render_brand(
    copy: ScreenCopy,
    canvas_width: int,
    canvas_height: int,
) -> Image.Image:
    """No-device closing frame: glyph above kicker + headline on the sky."""
    canvas = _sky_canvas(canvas_width, canvas_height)
    draw = ImageDraw.Draw(canvas)

    glyph = Image.open(BRAND_GLYPH).convert("RGBA")
    gw = round(canvas_width * GLYPH_WIDTH)
    glyph = glyph.resize((gw, round(glyph.height * gw / glyph.width)), Image.LANCZOS)
    gx = (canvas_width - glyph.width) // 2
    gy = round(canvas_height * GLYPH_TOP)
    canvas.alpha_composite(glyph, (gx, gy))

    side = round(canvas_width * SIDE_PADDING)
    _draw_text_block(
        draw, copy,
        center_x=canvas_width // 2,
        start_y=gy + glyph.height + round(canvas_height * GLYPH_TEXT_GAP),
        max_width=canvas_width - 2 * side,
    )
    return canvas


def render_screenshot(
    layout: str,
    screenshot,
    copy: ScreenCopy,
    canvas_width: int,
    canvas_height: int,
) -> Image.Image:
    """Render a screen with its layout. `screenshot` may be None for `brand`."""
    if layout == "brand":
        return render_brand(copy, canvas_width, canvas_height)
    return render_hero(screenshot, copy, canvas_width, canvas_height)
```

- [ ] **Step 11: Write `compositor.py` (full file)**

```python
#!/usr/bin/env python3
"""
Store Screenshot Compositor for CumulusVPN — Apple App Store.

Renders raw iOS captures into App Store-ready screenshots: the official
iPhone bezel on the brand sky gradient with kicker + headline, exported at
exact Apple sizes (6.9" master, 6.7", 6.5").

Usage:
    python3 compositor.py --locale en
    python3 compositor.py --only connect --locale en --preview
    python3 compositor.py --locale en --dry-run
"""

import argparse
import sys
from pathlib import Path

from lib.config import load_compositor_config, list_curated_locales, VALID_LAYOUTS
from lib.copy_resolver import resolve_copy
from lib.exporter import export_screenshot, write_metadata
from lib.layouts import render_screenshot
from lib.retouch import apply_retouch

STORE = "apple"
REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
DEFAULT_RAW_DIR = REPO_ROOT / "store" / "assets" / "screenshots" / "raw" / "ios"
DEFAULT_OUTPUT_DIR = Path(__file__).resolve().parent / "output"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate App Store screenshots for CumulusVPN"
    )
    parser.add_argument(
        "--locale", required=True,
        help="Curated locale code (e.g. en) or 'all' for all curated locales",
    )
    parser.add_argument(
        "--only", nargs="+",
        help="Process only specific screenshot keys",
    )
    parser.add_argument(
        "--layout",
        choices=sorted(VALID_LAYOUTS),
        help="Force layout for all screenshots (overrides screens.yaml)",
    )
    parser.add_argument(
        "--raw-dir", type=Path, default=DEFAULT_RAW_DIR,
        help=f"Directory containing raw screenshots (default: {DEFAULT_RAW_DIR})",
    )
    parser.add_argument(
        "--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR,
        help=f"Output directory (default: {DEFAULT_OUTPUT_DIR})",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Show copy resolution without rendering",
    )
    parser.add_argument(
        "--preview", action="store_true",
        help="Open results in Preview.app (macOS)",
    )
    return parser.parse_args()


def process_locale(locale: str, config, args: argparse.Namespace) -> list[dict]:
    """Process all screenshots for a single locale. Returns metadata entries."""
    from PIL import Image

    keys = args.only or [s.key for s in config.screens]
    entries = []

    print(f"\n{'=' * 60}")
    print(f"Locale: {locale} | Store: {STORE}")
    print(f"{'=' * 60}")

    for screen in config.screens:
        if screen.key not in keys:
            continue

        layout = args.layout or screen.layout
        raw_path = args.raw_dir / screen.raw_filename

        print(f"\n[{screen.order}/{len(config.screens)}] {screen.key} [{layout}]")

        copy = resolve_copy(screen.key, locale, raw_path)
        print(f"  Label: {copy.label}")
        print(f"  Headline: {copy.headline}")

        if args.dry_run:
            continue

        screenshot = None
        if layout != "brand":
            if not raw_path.exists():
                print(f"  WARNING: Raw screenshot not found: {raw_path}", file=sys.stderr)
                print(f"  Skipping {screen.key}")
                continue
            screenshot = Image.open(raw_path).convert("RGB")
            screenshot = apply_retouch(screen.key, screenshot)

        master_w = config.master_device.width
        master_h = config.master_device.height
        print(f"  Rendering at {master_w}x{master_h}...")
        master = render_screenshot(layout, screenshot, copy, master_w, master_h)

        screen_entries = export_screenshot(
            master, screen.key, screen.order, locale,
            config, args.output_dir, STORE,
        )
        entries.extend(screen_entries)

        for e in screen_entries:
            print(f"  -> {e['file']}")

    return entries


def main():
    args = parse_args()
    config = load_compositor_config()

    if args.locale == "all":
        locales = list_curated_locales()
        if not locales:
            print("ERROR: No curated locale files found", file=sys.stderr)
            sys.exit(1)
        print(f"Processing {len(locales)} locale(s): {', '.join(locales)}")
    else:
        locales = [args.locale]

    all_entries = []
    for locale in locales:
        all_entries.extend(process_locale(locale, config, args))

    if not args.dry_run and all_entries:
        meta_path = write_metadata(all_entries, args.output_dir)
        print(f"\nMetadata: {meta_path}")

    print(f"\n{'=' * 60}")
    if args.dry_run:
        print(f"DRY RUN complete. {len(locales)} locale(s) analyzed.")
    else:
        print(f"DONE. {len(all_entries)} file(s) exported.")
    print(f"{'=' * 60}")

    if args.preview and all_entries:
        import subprocess
        preview_files = []
        seen = set()
        for e in all_entries:
            key = (e["locale"], e["device"])
            if key not in seen:
                seen.add(key)
                preview_files.append(str(args.output_dir / e["file"]))
        subprocess.run(["open"] + preview_files[:8])


if __name__ == "__main__":
    main()
```

- [ ] **Step 12: Run the smoke test to verify it passes**

Run: `cd /Volumes/MAC_EXTERNAL/repos/cumulusvpn/.claude/skills/appstore-screenshots && python3 tests/smoke_test.py`
Expected: compositor log for 5 frames (brand shows no "Rendering" warning about a missing raw), then `SMOKE TEST PASS`.

Also run: `python3 compositor.py --locale en --only connect --dry-run` (from the skill dir)
Expected: exit 0; prints `Label: CONNECT` / `Headline: One tap.` + second line, `DRY RUN complete`.

Also run the negative path: `python3 compositor.py --locale de --dry-run`
Expected: exit non-zero with `ERROR: no curated copy for locale 'de' — create config/locales/de.yaml`.

- [ ] **Step 13: Commit**

```bash
cd /Volumes/MAC_EXTERNAL/repos/cumulusvpn
git add .claude/skills/appstore-screenshots
git commit -m "feat(skills): App Store screenshot compositor ported for CumulusVPN"
```

(Plain message — no trailers. Verify with `git log -1 --format=%B` that the
message is exactly one line.)

---

### Task 2: App Store skill — SKILL.md

**Files:**
- Create: `.claude/skills/appstore-screenshots/SKILL.md`

**Interfaces:**
- Consumes: the Task 1 CLI exactly as shipped (`--locale/--only/--raw-dir/--output-dir/--dry-run/--preview`), default raw dir `store/assets/screenshots/raw/ios/`, output tree `output/apple/en/<device>/NN-key.png`.
- Produces: the skill's user-facing instructions; no code.

- [ ] **Step 1: Write SKILL.md with exactly this content**

```markdown
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
```

- [ ] **Step 2: Verify the frontmatter parses and paths are real**

Run: `cd /Volumes/MAC_EXTERNAL/repos/cumulusvpn && python3 -c "
import yaml, pathlib
text = pathlib.Path('.claude/skills/appstore-screenshots/SKILL.md').read_text()
fm = yaml.safe_load(text.split('---')[1])
assert fm['name'] == 'appstore-screenshots', fm
print('frontmatter OK:', fm['name'])
"`
Expected: `frontmatter OK: appstore-screenshots`

Spot-check that every path SKILL.md mentions exists (`config/screens.yaml`,
`config/locales/en.yaml`, `tests/smoke_test.py`, `assets/brand-glyph.png`,
`clients/mobile/ios/CumulusVPN.xcworkspace`).

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/appstore-screenshots/SKILL.md
git commit -m "docs(skills): appstore-screenshots capture recipe and QC gate"
```

---

### Task 3: Play Store skill — engine, assets, configs, smoke test

**Files:**
- Create: everything under `.claude/skills/playstore-screenshots/` except `SKILL.md`
- Test: `.claude/skills/playstore-screenshots/tests/smoke_test.py`

**Interfaces:**
- Consumes: the completed `.claude/skills/appstore-screenshots/` from Task 1 (its lib/config/test files are the copy source — Approach 2 accepts the duplication), plus the Pixel frame assets from `/Volumes/MAC_EXTERNAL/repos/to-brief/.claude/skills/playstore-screenshots/assets/frames/`.
- Produces: same CLI shape with `STORE = "google"`, default raw dir `store/assets/screenshots/raw/android/`, output tree `output/google/en/phone/NN-key.png` (1080×2160).

- [ ] **Step 1: Write the failing smoke test (copy, then two exact edits)**

```bash
cd /Volumes/MAC_EXTERNAL/repos/cumulusvpn
mkdir -p .claude/skills/playstore-screenshots/tests
cp .claude/skills/appstore-screenshots/tests/smoke_test.py \
   .claude/skills/playstore-screenshots/tests/smoke_test.py
```

In the copied file, replace:

```python
RAW_SIZE = (1320, 2868)  # iPhone 16 Pro Max native capture
EXPECTED = [
    ("apple/en/iphone-6.9", (1320, 2868)),
    ("apple/en/iphone-6.7", (1290, 2796)),
    ("apple/en/iphone-6.5", (1242, 2688)),
]
```
with:
```python
RAW_SIZE = (1080, 2400)  # Pixel-class 20:9 capture; the bezel seat crops to fit
EXPECTED = [
    ("google/en/phone", (1080, 2160)),
]
```

`FRAMES`, `run_compositor`, and `main()` stay byte-identical.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Volumes/MAC_EXTERNAL/repos/cumulusvpn/.claude/skills/playstore-screenshots && python3 tests/smoke_test.py`
Expected: FAIL — `AssertionError: compositor exited 2` (no compositor.py yet).

- [ ] **Step 3: Copy the engine from the appstore skill + Pixel frame assets**

```bash
cd /Volumes/MAC_EXTERNAL/repos/cumulusvpn
APP=.claude/skills/appstore-screenshots
PLAY=.claude/skills/playstore-screenshots
SRC=/Volumes/MAC_EXTERNAL/repos/to-brief/.claude/skills/playstore-screenshots
mkdir -p "$PLAY/lib" "$PLAY/config/locales" "$PLAY/assets/frames" "$PLAY/assets/fonts"
cp "$APP/lib/__init__.py" "$APP/lib/config.py" "$APP/lib/exporter.py" "$APP/lib/frame.py" \
   "$APP/lib/fonts.py" "$APP/lib/copy_resolver.py" "$APP/lib/retouch.py" "$APP/lib/layouts.py" \
   "$PLAY/lib/"
cp "$APP/config/screens.yaml" "$PLAY/config/"
cp "$APP/config/locales/en.yaml" "$PLAY/config/locales/"
cp "$APP/assets/brand-glyph.png" "$PLAY/assets/"
cp "$APP/assets/fonts/Inter-Bold.ttf" "$PLAY/assets/fonts/"
cp "$APP/.gitignore" "$PLAY/.gitignore"
cp "$APP/compositor.py" "$PLAY/compositor.py"
cp "$SRC/assets/frames/pixel-portrait.png" "$SRC/assets/frames/geometry.json" "$PLAY/assets/frames/"
```

- [ ] **Step 4: Make `lib/frame.py`'s docstring store-agnostic (this skill's bezel is the self-rendered Pixel, not the Apple bezel)**

In `.claude/skills/playstore-screenshots/lib/frame.py`, replace the module
docstring (the first triple-quoted block, lines 1–8 of the copied file) with:

```python
"""Device frame rendering using the bezel described by assets/frames/geometry.json.

For this skill the frame is a self-rendered generic Pixel-style bezel
(pixel-portrait.png) with a transparent screen cutout — no third-party rights.
We seat the app screenshot behind the bezel; its opaque edge masks the
screenshot's square corners. Screen-cutout geometry lives in `geometry.json`.
"""
```

Everything below the docstring stays byte-identical to the appstore copy.

- [ ] **Step 5: Write `config/devices.yaml` (Google sizes)**

`.claude/skills/playstore-screenshots/config/devices.yaml`:

```yaml
# Google Play phone screenshots: each side 320–3840px, longer side ≤ 2× the
# shorter. 1080×2160 is exactly 2:1 — the max ratio Play allows (a full-bleed
# 20:9 1080×2400 would be 2.22:1 and rejected). Single master device.
# Apple sizes live in the separate appstore-screenshots skill.
stores:
  google:
    - name: phone
      width: 1080
      height: 2160
      master: true
```

- [ ] **Step 6: Adapt the copied `compositor.py` (four exact edits)**

The file was copied from the appstore skill in Step 3. Apply four replacements:

1. Docstring header — replace:
```python
Store Screenshot Compositor for CumulusVPN — Apple App Store.

Renders raw iOS captures into App Store-ready screenshots: the official
iPhone bezel on the brand sky gradient with kicker + headline, exported at
exact Apple sizes (6.9" master, 6.7", 6.5").
```
with:
```python
Store Screenshot Compositor for CumulusVPN — Google Play Store.

Renders raw Android captures into Play-ready screenshots: a generic Pixel
bezel on the brand sky gradient with kicker + headline, exported at the
Play-compliant phone size (1080×2160, exactly 2:1).
```
(the Usage block below it is unchanged)

2. Replace `STORE = "apple"` with `STORE = "google"`.

3. Replace
```python
DEFAULT_RAW_DIR = REPO_ROOT / "store" / "assets" / "screenshots" / "raw" / "ios"
```
with:
```python
DEFAULT_RAW_DIR = REPO_ROOT / "store" / "assets" / "screenshots" / "raw" / "android"
```

4. In `parse_args`, replace `description="Generate App Store screenshots for CumulusVPN"`
with `description="Generate Play Store screenshots for CumulusVPN"`.

- [ ] **Step 7: Run the smoke test to verify it passes**

Run: `cd /Volumes/MAC_EXTERNAL/repos/cumulusvpn/.claude/skills/playstore-screenshots && python3 tests/smoke_test.py`
Expected: 5 frames rendered to `google/en/phone` at 1080×2160, `SMOKE TEST PASS`.

Also: `python3 compositor.py --locale en --dry-run` → exit 0, 5 copy blocks, `DRY RUN complete`.

- [ ] **Step 8: Commit**

```bash
cd /Volumes/MAC_EXTERNAL/repos/cumulusvpn
git add .claude/skills/playstore-screenshots
git commit -m "feat(skills): Play Store screenshot compositor ported for CumulusVPN"
```

---

### Task 4: Play Store skill — SKILL.md

**Files:**
- Create: `.claude/skills/playstore-screenshots/SKILL.md`

**Interfaces:**
- Consumes: the Task 3 CLI (`STORE="google"`, raw dir `store/assets/screenshots/raw/android/`, output `output/google/en/phone/`).
- Produces: user-facing instructions; no code.

- [ ] **Step 1: Write SKILL.md with exactly this content**

```markdown
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
```

- [ ] **Step 2: Verify frontmatter + paths**

Run: `cd /Volumes/MAC_EXTERNAL/repos/cumulusvpn && python3 -c "
import yaml, pathlib
text = pathlib.Path('.claude/skills/playstore-screenshots/SKILL.md').read_text()
fm = yaml.safe_load(text.split('---')[1])
assert fm['name'] == 'playstore-screenshots', fm
print('frontmatter OK:', fm['name'])
"`
Expected: `frontmatter OK: playstore-screenshots`

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/playstore-screenshots/SKILL.md
git commit -m "docs(skills): playstore-screenshots capture recipe and QC gate"
```

---

### Task 5: Cross-checks and push

**Files:**
- No new files. Verification + push only.

**Interfaces:**
- Consumes: both completed skills, the 4 commits from Tasks 1–4.
- Produces: the branch pushed to `origin/main`.

- [ ] **Step 1: Re-run both smoke tests from a clean shell**

```bash
cd /Volumes/MAC_EXTERNAL/repos/cumulusvpn/.claude/skills/appstore-screenshots && python3 tests/smoke_test.py
cd /Volumes/MAC_EXTERNAL/repos/cumulusvpn/.claude/skills/playstore-screenshots && python3 tests/smoke_test.py
```
Expected: `SMOKE TEST PASS` twice.

- [ ] **Step 2: Leakage + hygiene checks**

```bash
cd /Volumes/MAC_EXTERNAL/repos/cumulusvpn
# No to-brief brand/path leakage in committed skill content:
grep -rn -i "to-brief\|tobrief\|Syne\|terracotta\|runonflux.github\|appstore@" .claude/skills/ && echo "LEAK FOUND" || echo "clean"
# No stray artifacts staged:
git status --short   # expect empty
git log --format='%B' origin/main..HEAD | grep -i "co-authored\|claude" && echo "TRAILER FOUND" || echo "messages clean"
# CI does not glob .claude/ (informational):
grep -rn "\.claude" .github/workflows/ || echo "workflows ignore .claude"
```
Expected: `clean`, empty status, `messages clean`, `workflows ignore .claude`.
If a leak or trailer is found, fix it (amend/reword) before pushing.

- [ ] **Step 3: Rebase-if-diverged and push (with retry)**

```bash
cd /Volumes/MAC_EXTERNAL/repos/cumulusvpn
for i in 1 2 3 4 5; do git fetch origin main && break || sleep 5; done
git rebase origin/main
for i in 1 2 3 4 5; do git push origin main && break || sleep 5; done
git log --oneline origin/main -5
```
Expected: push succeeds; the 4 task commits appear on `origin/main`. If the
rebase hits conflicts, stop and report BLOCKED with the conflicting files.
