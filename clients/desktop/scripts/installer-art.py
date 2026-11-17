"""Branded artwork for the Windows installers (NSIS setup.exe and WiX .msi).

Without it both installers fall back to their stock graphics, which read as
"some default app". Regenerate after a brand change:

    python3 clients/desktop/scripts/installer-art.py

Inputs:  brand/generated/icon-foreground-1024.png (cloud + bolt, transparent)
         brand/generated/icon-1024.png            (the full app icon tile)
Outputs: clients/desktop/src-tauri/windows/art/*.bmp, at the sizes the
         installers require (tauri.windows.conf.json points at them).
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'clients/desktop/src-tauri/windows/art'
_fg = Image.open(ROOT / 'brand/generated/icon-foreground-1024.png').convert('RGBA')
# The adaptive-icon foreground carries a wide safe-zone margin; crop to the mark.
FOREGROUND = _fg.crop(_fg.getchannel('A').getbbox())
TILE = Image.open(ROOT / 'brand/generated/icon-1024.png').convert('RGB')

# Brand tokens (clients/desktop/src/styles.css, dark theme).
BG_TOP = (12, 26, 40)
BG_BOTTOM = (7, 11, 17)
CYAN = (52, 228, 218)
INK = (234, 241, 248)
INK_2 = (166, 182, 198)
WHITE = (255, 255, 255)


def font(size: int, bold: bool) -> ImageFont.FreeTypeFont:
    # Avenir Next ships with macOS; index 0 is Bold, 7 Regular in the .ttc.
    path = '/System/Library/Fonts/Avenir Next.ttc'
    try:
        return ImageFont.truetype(path, size, index=0 if bold else 7)
    except OSError:
        return ImageFont.load_default()


def brand_panel(w: int, h: int, logo: int, logo_y: int, title: bool) -> Image.Image:
    """The dark panel: navy gradient, a soft cyan glow, the logo, the name."""
    panel = Image.new('RGB', (w, h))
    px = panel.load()
    for y in range(h):
        t = y / max(1, h - 1)
        row = tuple(round(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t) for i in range(3))
        for x in range(w):
            px[x, y] = row

    mw = logo
    mh = round(logo * FOREGROUND.height / FOREGROUND.width)

    glow = Image.new('L', (w, h), 0)
    r = int(logo * 0.75)
    cx, cy = w // 2, logo_y + mh // 2
    ImageDraw.Draw(glow).ellipse((cx - r, cy - r, cx + r, cy + r), fill=60)
    glow = glow.filter(ImageFilter.GaussianBlur(logo // 3))
    panel = Image.composite(Image.new('RGB', (w, h), CYAN), panel, glow)

    mark = FOREGROUND.resize((mw, mh), Image.LANCZOS)
    panel.paste(mark, ((w - mw) // 2, logo_y), mark)

    if title:
        d = ImageDraw.Draw(panel)
        name = font(19, bold=True)
        tag = font(11, bold=False)
        y = logo_y + mh + 16
        for text, f, colour, gap in (
            ('CumulusVPN', name, INK, 6),
            ('No account · no logs', tag, INK_2, 0),
        ):
            tw = d.textlength(text, font=f)
            d.text(((w - tw) / 2, y), text, font=f, fill=colour)
            y += f.size + gap
    return panel


def header(w: int, h: int, tile: int) -> Image.Image:
    """A white strip (the installers draw their page title on the left) with
    the app icon at the right, as it appears on the desktop."""
    img = Image.new('RGB', (w, h), WHITE)
    icon = TILE.resize((tile, tile), Image.LANCZOS)
    mask = Image.new('L', (tile, tile), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, tile - 1, tile - 1), radius=tile // 5, fill=255)
    img.paste(icon, (w - tile - (h - tile) // 2, (h - tile) // 2), mask)
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    # NSIS (setup.exe): welcome/finish sidebar 164x314, page header 150x57.
    brand_panel(164, 314, logo=92, logo_y=96, title=True).save(OUT / 'nsis-sidebar.bmp')
    header(150, 57, tile=45).save(OUT / 'nsis-header.bmp')

    # WiX (.msi): top banner 493x58; welcome/exit background 493x312, whose
    # left 164px is the picture and the rest the white text area.
    header(493, 58, tile=46).save(OUT / 'wix-banner.bmp')
    dialog = Image.new('RGB', (493, 312), WHITE)
    dialog.paste(brand_panel(164, 312, logo=92, logo_y=95, title=True), (0, 0))
    dialog.save(OUT / 'wix-dialog.bmp')

    for p in sorted(OUT.glob('*.bmp')):
        with Image.open(p) as im:
            print(f'{p.relative_to(ROOT)}  {im.size[0]}x{im.size[1]}')


if __name__ == '__main__':
    main()
