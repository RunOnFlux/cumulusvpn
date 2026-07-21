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
