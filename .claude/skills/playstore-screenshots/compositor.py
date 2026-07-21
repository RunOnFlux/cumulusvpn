#!/usr/bin/env python3
"""
Store Screenshot Compositor for CumulusVPN — Google Play Store.

Renders raw Android captures into Play-ready screenshots: a generic Pixel
bezel on the brand sky gradient with kicker + headline, exported at the
Play-compliant phone size (1080×2160, exactly 2:1).

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

STORE = "google"
REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
DEFAULT_RAW_DIR = REPO_ROOT / "store" / "assets" / "screenshots" / "raw" / "android"
DEFAULT_OUTPUT_DIR = Path(__file__).resolve().parent / "output"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate Play Store screenshots for CumulusVPN"
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
