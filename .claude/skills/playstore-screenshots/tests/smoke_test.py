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
RAW_SIZE = (1080, 2400)  # Pixel-class 20:9 capture; the bezel seat crops to fit
EXPECTED = [
    ("google/en/phone", (1080, 2160)),
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
