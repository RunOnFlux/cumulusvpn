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
