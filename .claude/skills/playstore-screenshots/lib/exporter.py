"""Multi-size export for the store screenshot compositor.

Renders at master size (1320x2868), then scales down to all required
device dimensions. Outputs organized by store/locale/device.
"""

import json
from pathlib import Path

from PIL import Image

from .config import CompositorConfig, DeviceSpec


def export_screenshot(
    master_image: Image.Image,
    screen_key: str,
    order: int,
    locale: str,
    config: CompositorConfig,
    output_dir: Path,
    store: str = "both",
) -> list[dict]:
    """Export a master-resolution screenshot to all required sizes.

    Returns a list of metadata entries for each exported file.
    """
    devices = config.get_devices(store)
    entries = []
    master_w = config.master_device.width
    master_h = config.master_device.height

    for device in devices:
        # Determine store name for directory structure
        store_name = None
        for sn, devs in config.stores.items():
            if device in devs:
                store_name = sn
                break
        if store_name is None:
            continue

        # Scale if needed
        if device.width == master_w and device.height == master_h:
            export_img = master_image
        else:
            export_img = master_image.resize(
                (device.width, device.height),
                Image.LANCZOS,
            )

        # Convert to RGB (no alpha — store requirement); flatten onto sky top
        if export_img.mode == "RGBA":
            rgb = Image.new("RGB", export_img.size, (16, 32, 58))
            rgb.paste(export_img, (0, 0), export_img)
            export_img = rgb

        # Output path: output_dir/store/locale/device/NN-key.png
        device_dir = output_dir / store_name / locale / device.name
        device_dir.mkdir(parents=True, exist_ok=True)
        filename = f"{order:02d}-{screen_key}.png"
        output_path = device_dir / filename
        export_img.save(str(output_path), "PNG", optimize=True)

        entries.append({
            "store": store_name,
            "locale": locale,
            "device": device.name,
            "dimensions": f"{device.width}x{device.height}",
            "file": str(output_path.relative_to(output_dir)),
            "screen_key": screen_key,
            "order": order,
        })

    return entries


def write_metadata(entries: list[dict], output_dir: Path) -> Path:
    """Write metadata.json with full manifest of exported files."""
    meta_path = output_dir / "metadata.json"
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(entries, f, indent=2, ensure_ascii=False)
    return meta_path
