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

## Known gap — the hero frame is the DISCONNECTED state

`01-connect.png` shows "Not connected" / "TAP TO CONNECT", **not** an active
session. Packet-tunnel extensions do not run on the iOS Simulator, so a
connected-state capture is impossible there.

The set is **truthful and uploadable as-is** — the headline "One tap.
Encrypted." reads correctly against the tap-to-connect orb. But a connected
hero frame (live city, elapsed time, throughput) is substantially stronger
marketing. To upgrade it:

1. Run the Release build on a **physical iPhone** and connect to a gateway.
2. Capture via Xcode → Devices and Simulators (or `xcrun devicectl`). Any
   modern ~19.5:9 iPhone works — the compositor rescales into the bezel, so the
   raw need not be 1320×2868.
3. Replace `../raw/ios/connect.png`, regenerate with
   `cd .claude/skills/appstore-screenshots && python3 compositor.py --locale en`,
   and copy the output back over these files.

## iPad — still missing

The app is universal (`TARGETED_DEVICE_FAMILY "1,2"`), so App Store Connect also
requires a **13" iPad (2064×2752)** set, which does not exist yet. Either
capture one or drop iPad support (`TARGETED_DEVICE_FAMILY "1"`).
