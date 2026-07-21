"""Device frame rendering using the official Apple iPhone 16 Pro Max bezel.

`assets/frames/iphone-portrait.png` is an official Apple Product Bezel (Black
Titanium, portrait) with a transparent screen cutout — the sanctioned,
rejection-safe marketing asset. We seat the app screenshot behind the bezel; the
bezel's opaque titanium edge masks the screenshot's square corners and its opaque
Dynamic Island floats on top. Screen-cutout geometry lives in `geometry.json`.
"""

import json
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

FRAMES_DIR = Path(__file__).resolve().parent.parent / "assets" / "frames"
GEOMETRY_JSON = FRAMES_DIR / "geometry.json"


@lru_cache(maxsize=1)
def _load_frame() -> tuple[Image.Image, dict]:
    geom = json.loads(GEOMETRY_JSON.read_text(encoding="utf-8"))
    frame = Image.open(FRAMES_DIR / geom["frame_file"]).convert("RGBA")
    return frame, geom


@lru_cache(maxsize=1)
def _screen_mask() -> Image.Image:
    """Exact screen-region mask derived from the frame's own alpha (L, frame-sized).

    The screen is the transparent region enclosed by the bezel. We flood-fill the
    border-connected transparent area (the outer margin around the device) and keep
    whatever transparent pixels it can't reach — i.e. the screen. This matches the
    real screen curve exactly, with no radius guessing (too-large → cream gap at the
    corners; too-small/square → screenshot bleeds past the body)."""
    frame, _ = _load_frame()
    fw, fh = frame.size
    trans = frame.split()[3].point(lambda a: 255 if a < 8 else 0).convert("L")
    for seed in ((0, 0), (fw - 1, 0), (0, fh - 1), (fw - 1, fh - 1)):
        if trans.getpixel(seed) == 255:
            ImageDraw.floodfill(trans, seed, 100)  # mark the outer margin
    return trans.point(lambda v: 255 if v == 255 else 0)


def _seat_screenshot(screenshot: Image.Image) -> Image.Image:
    """Bezel with the screenshot seated in its screen cutout, at native frame res."""
    frame, geom = _load_frame()
    fw, fh = frame.size
    sl, st = geom["screen_left"], geom["screen_top"]
    sw, sh = geom["screen_width"], geom["screen_height"]

    ss = screenshot.convert("RGB")
    scw, sch = ss.size
    scale = max(sw / scw, sh / sch)  # cover
    rw, rh = round(scw * scale), round(sch * scale)
    ss = ss.resize((rw, rh), Image.LANCZOS)
    cx, cy = (rw - sw) // 2, (rh - sh) // 2
    ss = ss.crop((cx, cy, cx + sw, cy + sh))

    ss_layer = Image.new("RGB", (fw, fh), (0, 0, 0))
    ss_layer.paste(ss, (sl, st))

    base = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
    base.paste(ss_layer, (0, 0), _screen_mask())  # only the exact screen region
    base.alpha_composite(frame)                   # official bezel on top + Dynamic Island
    return base


def render_framed_device(screenshot: Image.Image, target_width: int) -> Image.Image:
    """RGBA image of the screenshot seated in the official iPhone frame, scaled so the
    whole device is `target_width` px wide. No shadow; transparent around the device."""
    base = _seat_screenshot(screenshot)
    fw, fh = base.size
    if target_width != fw:
        base = base.resize((target_width, round(fh * target_width / fw)), Image.LANCZOS)
    return base


def paste_with_shadow(
    canvas: Image.Image,
    device: Image.Image,
    x: int,
    y: int,
    blur: int = 44,
    opacity: int = 46,
    offset_y: int = 8,
) -> None:
    """Paste `device` (RGBA) onto `canvas` at (x, y) with a soft, even ambient shadow.

    The shadow uses a small vertical offset and a wide blur so it hugs the device instead
    of casting distinct blobs off the protruding side buttons (which otherwise read as
    little wedges bleeding past the frame edge)."""
    alpha = device.split()[3]
    silhouette = Image.new("RGBA", device.size, (0, 0, 0, 0))
    silhouette.putalpha(alpha.point(lambda a: opacity if a > 0 else 0))
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    shadow.alpha_composite(silhouette, (x, y + offset_y))
    shadow = shadow.filter(ImageFilter.GaussianBlur(blur))
    canvas.alpha_composite(shadow)
    canvas.alpha_composite(device, (x, y))
