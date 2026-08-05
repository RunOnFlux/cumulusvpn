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

Re-captured 2026-07-31 from a Release build on the **iPad Pro 13-inch (M4) /
iOS 26.5 Simulator**, in **screenshot mode** (`CVPN_SCREENSHOT=1`, see
`clients/mobile/src/lib/screenshot.ts`). The app shows no purchase UI anywhere,
following the 1.0.2 (15) rejection.

| File | Screen |
|------|--------|
| `01-connect.png`   | Connect — **connected**, Germany, session stats |
| `02-countries.png` | Choose location — country list with quality ratings |
| `03-tier.png`      | Settings — plan status, kill switch, Stealth mode |
| `04-multihop.png`  | Connect — multi-hop route-style selector |

`01-connect` is a live connected hero now. Packet-tunnel extensions still do not
run on the Simulator; screenshot mode supplies the session, and the latency
figures are those a client near each node measures rather than whatever the
capture machine happened to see. The constraints that data has to satisfy are
documented in `screenshot.ts` — the short version is representative-not-invented
numbers, throughput under the free tier's own 100 KB/s cap, and no fabricated
features. `yarn verify:no-demo-data` proves none of it ships.

`03-tier` is the Settings screen, restored in place of the privacy-disclosure
frame that briefly held slot 3. This does not re-open the 2.3.7 finding: Apple
cited the **overlay copy** the iPhone set puts on this frame ("FREE TIER / Free
to use…"), not the screen. The iPad set is unframed and carries no overlay copy
at all, so there is nothing here for 2.3.7 to attach to.

### Known cosmetic artifact

Every one of these captures — including the 2026-07-22 and 07-30 sets before it
— has a faint grey arc in the bottom-right corner, an artifact of `simctl io`
on the iPad simulator rather than anything the app draws. Small, in the corner,
and previously uploaded as-is. Retouch it out if it ever bothers review.

## Build note

Requires `clients/native/wgnest/build-ios.sh` (→ `Wgnest.xcframework`) to have
run first, same as any iOS build — see `../README.md`.
