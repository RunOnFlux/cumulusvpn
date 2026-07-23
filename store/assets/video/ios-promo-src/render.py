#!/usr/bin/env python3
"""CumulusVPN iOS promo video renderer.

1080x1920 @ 30fps, 40 s. Reuses the appstore-screenshots skill's official
Apple bezel compositor + brand fonts. Scenes: brand intro -> connect ->
countries -> multi-hop -> free tier -> brand outro. Frames are piped raw to
ffmpeg (video-silent.mp4); music is muxed in a second pass.
"""

import math
import subprocess
import sys
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

REPO = Path(__file__).resolve().parents[4]  # store/assets/video/ios-promo-src -> repo root
SKILL = REPO / ".claude/skills/appstore-screenshots"
RAW = REPO / "store/assets/screenshots/raw/ios"
sys.path.insert(0, str(SKILL))

from lib.fonts import load_font          # noqa: E402
from lib.frame import render_framed_device  # noqa: E402

W, H = 1080, 1920
FPS = 30
DUR = 40.0
NFRAMES = int(DUR * FPS)

INK = (234, 243, 250)
INK_DIM = (234, 243, 250, 165)
CYAN = (52, 228, 218)
SKY_STOPS = ((16, 32, 58), (29, 58, 99), (47, 111, 158))

TRACK = 6          # kicker letter tracking px
LABEL_SIZE = 34
HEAD_SIZE = 80
DEV_MASTER_W = 910  # pre-render width; displayed smaller so the FULL phone fits
DEV_W = 650         # display width — whole device visible, no bottom bleed
DEV_Y = 546         # top edge; bottom lands at 1872, 48px above the canvas edge

SCENES = [
    ("connect",   "CONNECT",   "One tap.\nEncrypted.",            5.30, 11.60),
    ("countries", "COUNTRIES", "Pick a country.\nSee the latency.", 12.05, 18.80),
    ("multihop",  "MULTI-HOP", "Two hops when\none isn't enough.", 19.25, 26.00),
    ("tier",      "FREE TIER", "Free to use.\nHonest limits.",     26.50, 32.20),
]
CROSSFADES = [11.85, 19.05, 26.25]   # screen-content blends between scenes
XFADE = 0.8

DEV_IN_A, DEV_IN_B = 4.80, 5.90      # device rises in
DEV_OUT_A, DEV_OUT_B = 32.40, 33.35  # device drops out
INTRO_OUT_A, INTRO_OUT_B = 4.20, 4.85
OUTRO_IN_A, OUTRO_IN_B = 33.30, 34.10
BLACK_A, BLACK_B = 38.90, 40.00


def clamp01(x):
    return max(0.0, min(1.0, x))


def smooth(x):
    x = clamp01(x)
    return x * x * (3 - 2 * x)


def ease_out_cubic(x):
    x = clamp01(x)
    return 1 - (1 - x) ** 3


def ease_in_cubic(x):
    x = clamp01(x)
    return x ** 3


def sky_canvas():
    ys = np.linspace(0.0, 1.0, H)
    pos = np.linspace(0.0, 1.0, len(SKY_STOPS))
    ch = [np.interp(ys, pos, [s[i] for s in SKY_STOPS]) for i in range(3)]
    grad = np.stack(ch, axis=-1).round().astype(np.uint8)
    return Image.fromarray(np.repeat(grad[:, None, :], W, axis=1), "RGB").convert("RGBA")


def make_blob(color, radius, alpha):
    size = radius * 2 + 500
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c = size // 2
    d.ellipse([c - radius, c - radius, c + radius, c + radius], fill=color + (alpha,))
    return img.filter(ImageFilter.GaussianBlur(220))


def draw_kicker(draw, text, cx, y, alpha=255):
    font = load_font("label", LABEL_SIZE)
    adv = [draw.textlength(ch, font=font) + TRACK for ch in text]
    w = sum(adv) - TRACK
    x = cx - w / 2
    for ch, a in zip(text, adv):
        draw.text((x, y), ch, fill=CYAN + (alpha,), font=font)
        x += a
    bbox = draw.textbbox((0, 0), text, font=font)
    return y + (bbox[3] - bbox[1])


def make_text_block(label, headline, sub=None, head_size=HEAD_SIZE):
    """RGBA block (full canvas width) with tracked kicker + headline (+sub)."""
    img = Image.new("RGBA", (W, 620), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    y = draw_kicker(d, label, W // 2, 8) + 26
    font_h = load_font("headline", head_size)
    for seg in headline.split("\n"):
        lw = d.textlength(seg, font=font_h)
        d.text((W // 2 - lw / 2, y), seg, fill=INK + (255,), font=font_h, anchor="la")
        y += round(head_size * 1.10)
    if sub:
        y += 26
        font_s = load_font("label", 28)
        lw = d.textlength(sub, font=font_s)
        d.text((W // 2 - lw / 2, y), sub, fill=INK_DIM, font=font_s, anchor="la")
        y += 40
    return img.crop((0, 0, W, y + 12))


def make_intro_block():
    glyph = Image.open(SKILL / "assets/brand-glyph.png").convert("RGBA")
    gw = 500
    glyph = glyph.resize((gw, round(glyph.height * gw / glyph.width)), Image.LANCZOS)
    img = Image.new("RGBA", (W, glyph.height + 240), (0, 0, 0, 0))
    img.alpha_composite(glyph, ((W - gw) // 2, 0))
    d = ImageDraw.Draw(img)
    font_w = load_font("headline", 96)
    y = glyph.height - 30
    lw = d.textlength("CumulusVPN", font=font_w)
    d.text((W // 2 - lw / 2, y), "CumulusVPN", fill=INK + (255,), font=font_w, anchor="la")
    y += 130
    draw_kicker(d, "THE DECENTRALIZED VPN", W // 2, y)
    return img.crop((0, 0, W, y + 60))


def make_outro_block():
    glyph = Image.open(SKILL / "assets/brand-glyph.png").convert("RGBA")
    gw = 430
    glyph = glyph.resize((gw, round(glyph.height * gw / glyph.width)), Image.LANCZOS)
    text = make_text_block("NO ACCOUNT", "No logs.\nPowered by Flux.",
                           sub="cumulusvpn.com", head_size=84)
    img = Image.new("RGBA", (W, glyph.height - 40 + text.height), (0, 0, 0, 0))
    img.alpha_composite(glyph, ((W - gw) // 2, 0))
    img.alpha_composite(text, (0, glyph.height - 40))
    return img


def paste_faded(canvas, block, y, alpha):
    if alpha <= 0.003:
        return
    if alpha >= 0.997:
        canvas.alpha_composite(block, (0, int(round(y))))
        return
    arr = np.array(block, dtype=np.uint16)
    arr[..., 3] = (arr[..., 3] * alpha).astype(np.uint16)
    canvas.alpha_composite(Image.fromarray(arr.astype(np.uint8), "RGBA"), (0, int(round(y))))


print("pre-rendering devices...")
DEVICES = {}
for key in ["connect", "countries", "multihop", "tier"]:
    shot = Image.open(RAW / f"{key}.png").convert("RGB")
    DEVICES[key] = render_framed_device(shot, DEV_MASTER_W)
DEV_AR = DEVICES["connect"].height / DEVICES["connect"].width


@lru_cache(maxsize=96)
def device_at(key, w):
    # Called once per screen now (fixed display width) — worth the LANCZOS quality.
    return DEVICES[key].resize((w, round(w * DEV_AR)), Image.LANCZOS)


def screen_key_at(t):
    """(keyA, keyB, blend) for the screen content at time t."""
    keys = [s[0] for s in SCENES]
    for i, tb in enumerate(CROSSFADES):
        if t < tb - XFADE / 2:
            return keys[i], keys[i], 0.0
        if t <= tb + XFADE / 2:
            return keys[i], keys[i + 1], smooth((t - (tb - XFADE / 2)) / XFADE)
    return keys[-1], keys[-1], 0.0


BG = sky_canvas()
BLOB1 = make_blob((255, 255, 255), 620, 34)
BLOB2 = make_blob(CYAN, 500, 26)
INTRO = make_intro_block()
OUTRO = make_outro_block()
TEXTS = {s[0]: make_text_block(s[1], s[2]) for s in SCENES}

ff = subprocess.Popen(
    ["ffmpeg", "-y", "-loglevel", "error",
     "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
     "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
     "video-silent.mp4"],
    stdin=subprocess.PIPE,
)

print("rendering frames...")
for fi in range(NFRAMES):
    t = fi / FPS
    frame = BG.copy()

    # drifting cloud glows
    b1x = 540 + 380 * math.sin(2 * math.pi * t / 29 + 1.0) - BLOB1.width / 2
    b1y = 480 + 260 * math.sin(2 * math.pi * t / 23 + 2.1) - BLOB1.height / 2
    b2x = 540 + 420 * math.sin(2 * math.pi * t / 31 + 4.2) - BLOB2.width / 2
    b2y = 1320 + 300 * math.sin(2 * math.pi * t / 26 + 0.4) - BLOB2.height / 2
    frame.alpha_composite(BLOB1, (int(b1x), int(b1y)))
    frame.alpha_composite(BLOB2, (int(b2x), int(b2y)))

    # ---- intro block
    if t < INTRO_OUT_B:
        a_in = smooth((t - 0.35) / 0.9)
        a_out = 1.0 - smooth((t - INTRO_OUT_A) / (INTRO_OUT_B - INTRO_OUT_A))
        alpha = a_in * a_out
        rise = (1 - ease_out_cubic((t - 0.35) / 1.1)) * 46 - (1 - a_out) * 30
        paste_faded(frame, INTRO, (H - INTRO.height) / 2 - 80 + rise, alpha)

    # ---- device (static while on screen — no float, no zoom; slides in/out only)
    if DEV_IN_A <= t < DEV_OUT_B:
        if t < DEV_IN_B:
            p = ease_out_cubic((t - DEV_IN_A) / (DEV_IN_B - DEV_IN_A))
            dy = (H + 60) + (DEV_Y - (H + 60)) * p
        else:
            dy = DEV_Y
            if t >= DEV_OUT_A:
                p = ease_in_cubic((t - DEV_OUT_A) / (DEV_OUT_B - DEV_OUT_A))
                dy += (H + 80 - dy) * p
        ka, kb, blend = screen_key_at(t)
        if blend <= 0.001:
            dev = device_at(ka, DEV_W)
        elif blend >= 0.999:
            dev = device_at(kb, DEV_W)
        else:
            dev = Image.blend(device_at(ka, DEV_W), device_at(kb, DEV_W), blend)
        frame.alpha_composite(dev, ((W - dev.width) // 2, int(round(dy))))

    # ---- scene captions
    for key, label, headline, t_in, t_out in SCENES:
        if not (t_in - 0.05 <= t <= t_out + 0.5):
            continue
        a_in = smooth((t - t_in) / 0.55)
        a_out = 1.0 - smooth((t - t_out) / 0.45)
        alpha = a_in * a_out
        y = 130 + (1 - ease_out_cubic((t - t_in) / 0.65)) * 42 - (1 - a_out) * 26
        paste_faded(frame, TEXTS[key], y, alpha)

    # ---- outro block
    if t >= OUTRO_IN_A:
        a_in = smooth((t - OUTRO_IN_A) / (OUTRO_IN_B - OUTRO_IN_A))
        rise = (1 - ease_out_cubic((t - OUTRO_IN_A) / 1.0)) * 46
        paste_faded(frame, OUTRO, (H - OUTRO.height) / 2 - 70 + rise, a_in)

    rgb = np.asarray(frame.convert("RGB"))

    # fade from black at the head, to black at the tail
    if t < 0.55:
        rgb = (rgb * smooth(t / 0.55)).astype(np.uint8)
    elif t > BLACK_A:
        rgb = (rgb * (1.0 - smooth((t - BLACK_A) / (BLACK_B - BLACK_A)))).astype(np.uint8)

    ff.stdin.write(rgb.tobytes())
    if fi % 120 == 0:
        print(f"  frame {fi}/{NFRAMES} (t={t:.1f}s)")

ff.stdin.close()
ff.wait()
print("video-silent.mp4 done" if ff.returncode == 0 else f"FFMPEG FAILED rc={ff.returncode}")
sys.exit(ff.returncode)
