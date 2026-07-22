#!/usr/bin/env bash
# Verify 16 KB page alignment of every 64-bit .so we ship to Google Play.
#
# Play REJECTS uploads whose 64-bit native libs are not 16 KB-aligned for apps
# targeting Android 15+ (enforced since 2025-11-01). 32-bit ABIs are exempt.
#
# Usage:
#   ./check-16k.sh                       # checks the built wgmobile.aar
#   ./check-16k.sh path/to/app.aab ...   # checks any .aar/.aab/.apk/.so
#
# Exits non-zero if any 64-bit lib is under-aligned, so it can gate CI.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

targets=("$@")
if [ ${#targets[@]} -eq 0 ]; then
  targets=("$here/../../mobile/android/app/libs/wgmobile.aar")
fi

python3 - "${targets[@]}" <<'PY'
import os, struct, sys, zipfile

PT_LOAD, MIN_ALIGN = 1, 16384
failures = []


def load_align(data):
    """Return (max PT_LOAD p_align, is_64bit) or (None, None) if not an ELF."""
    if data[:4] != b"\x7fELF":
        return None, None
    is64, little = data[4] == 2, data[5] == 1
    end = "<" if little else ">"
    if is64:
        phoff, = struct.unpack_from(end + "Q", data, 0x20)
        phentsize, phnum = struct.unpack_from(end + "HH", data, 0x36)
        align_off, fmt = 0x30, end + "Q"
    else:
        phoff, = struct.unpack_from(end + "I", data, 0x1C)
        phentsize, phnum = struct.unpack_from(end + "HH", data, 0x2A)
        align_off, fmt = 0x1C, end + "I"
    best = 0
    for i in range(phnum):
        off = phoff + i * phentsize
        if struct.unpack_from(end + "I", data, off)[0] != PT_LOAD:
            continue
        best = max(best, struct.unpack_from(fmt, data, off + align_off)[0])
    return best, is64


def check(label, data):
    align, is64 = load_align(data)
    if align is None:
        return
    if not is64:
        print(f"  --  {label}: 32-bit, exempt")
    elif align >= MIN_ALIGN:
        print(f"  OK  {label}: p_align={align} (0x{align:x})")
    else:
        print(f"  !!  {label}: p_align={align} (0x{align:x}) < {MIN_ALIGN}")
        failures.append(label)


for path in sys.argv[1:]:
    if not os.path.exists(path):
        sys.exit(f"missing: {path}")
    print(f"\n=== {path} ===")
    if path.endswith((".aar", ".aab", ".apk", ".jar", ".zip")):
        with zipfile.ZipFile(path) as z:
            sos = sorted(n for n in z.namelist() if n.endswith(".so"))
            if not sos:
                print("  (no .so inside)")
            for n in sos:
                check(n, z.read(n))
    else:
        with open(path, "rb") as fh:
            check(os.path.basename(path), fh.read())

if failures:
    print(f"\nFAIL: {len(failures)} 64-bit lib(s) under-aligned — Play will reject this upload.")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
print("\nPASS: all 64-bit libs are 16 KB-aligned.")
PY
