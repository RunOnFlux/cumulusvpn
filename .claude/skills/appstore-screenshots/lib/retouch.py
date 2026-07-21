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
