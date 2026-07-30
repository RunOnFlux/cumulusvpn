# iPad store screenshots — PROVENANCE

**Real iPad captures, cleared for upload to App Store Connect** (the 13" iPad
slot, required because the app is universal, `TARGETED_DEVICE_FAMILY "1,2"`).

Captured 2026-07-22 from a **Release** build on the **iPad Pro 13-inch (M4)
Simulator**, at the exact **2064×2752** the 13" slot requires. Raws in
`../../raw/ios-ipad/`.

## Unframed — on purpose

Unlike the iPhone sets, these are **not** seated in a device bezel: the
`appstore-screenshots` compositor only ships an iPhone frame
(`assets/frames/iphone-portrait.png`), no iPad frame. Apple accepts **unframed
screenshots at the exact display resolution**, so these upload as-is. If visual
parity with the framed iPhone set is wanted later, add an iPad bezel to the
compositor and re-run against the raws.

## Frames

Re-captured 2026-07-30 from a Release build on the **iPad Pro 13-inch (M4) /
iOS 26.5 Simulator** after the 1.0.2 (15) rejection: the app no longer shows
any purchase UI (no upsell line, no "tap to upgrade"), and the old `03-tier`
frame was replaced by the privacy disclosure (Apple 2.3.7 counts "free" in
screenshots as a price reference).

| File | Screen |
|------|--------|
| `01-connect.png`   | Connect — disconnected, nearest gateway |
| `02-countries.png` | Choose location — country list with live latency |
| `03-privacy.png`   | "Before you connect" data disclosure |
| `04-multihop.png`  | Connect — multi-hop route-style selector |

Same disconnected-hero caveat as iPhone: packet-tunnel extensions do not run on
the Simulator, so `01-connect` is the "TAP TO CONNECT" state, not an active
session. Truthful and uploadable; a connected frame would need a physical iPad.

## Build note

Requires `clients/native/wgnest/build-ios.sh` (→ `Wgnest.xcframework`) to have
run first, same as any iOS build — see `../README.md`.
