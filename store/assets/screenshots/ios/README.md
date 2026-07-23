# iOS store screenshots — PROVENANCE

**These are real iOS captures and are cleared for upload to App Store Connect.**

Captured 2026-07-22 from a **Release** build running on the **iOS 18.6 Simulator
(iPhone 16 Pro Max)**, seated in the official Apple iPhone bezel by
`.claude/skills/appstore-screenshots/compositor.py`. Raws live in `../raw/ios/`.
This replaces the previous Android-in-bezel placeholder set, which was **not**
uploadable under Apple 2.3.3 / 2.3.10.

Build provenance:
- `clients/native/wgnest/build-ios.sh` → `Wgnest.xcframework` — **required
  first**; the iOS build fails without it, and like the Android AAR it is a
  gitignored artifact, so a clean checkout must run this before `xcodebuild`.
- `xcodebuild -workspace CumulusVPN.xcworkspace -scheme CumulusVPN
  -configuration Release -sdk iphonesimulator`
- Canonical marketing status bar applied before every capture:
  `xcrun simctl status_bar … override --time 9:41 --batteryLevel 100
  --batteryState charged --dataNetwork wifi --wifiBars 3`

Slots: `iphone-6.9/` (1320×2868, master), `iphone-6.7/` (1290×2796),
`iphone-6.5/` (1242×2688). All verified at those exact dimensions.

**Re-captures (2026-07-23):**
- `02-countries.png` re-taken after the fleet expansion, from a Release build
  on the **iPhone 16 / iOS 18.5 Simulator** (raw 1179×2556 — the compositor
  rescales any ~19.5:9 raw into the bezel). Shows the live picker with
  **"Search 20 countries…"** (Finland 15 nodes · Helsinki, Italy, Malaysia,
  etc. — all real discovery + latency data against the live fleet, with the
  26-spec signed directory bundled). Retake whenever the country count grows
  meaningfully: build Release, install on a booted sim, accept the disclosure,
  tap the Automatic row, wait for latency dots, clear any app-switch breadcrumb
  (home → relaunch), then `simctl io booted screenshot`.

## Hero frame — RESOLVED (was: disconnected-state gap)

`01-connect.png` is now a **real connected session** captured on a physical
iPhone (Netherlands exit, elapsed time, live throughput — raw 1170×2532).
Packet-tunnel extensions still do not run on the iOS Simulator, so any future
connected-state re-capture must again use a physical device: run the Release
build, connect, capture via Xcode → Devices and Simulators (or
`xcrun devicectl`), replace `../raw/ios/connect.png`, regenerate with
`cd .claude/skills/appstore-screenshots && python3 compositor.py --locale en`,
and copy the output back over these files.

## iPad — still missing

The app is universal (`TARGETED_DEVICE_FAMILY "1,2"`), so App Store Connect also
requires a **13" iPad (2064×2752)** set, which does not exist yet. Either
capture one or drop iPad support (`TARGETED_DEVICE_FAMILY "1"`).
