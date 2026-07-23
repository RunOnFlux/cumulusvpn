# Store demo video

`play-vpnservice-demo.mp4` — the demonstration video required by two Google Play
declarations for CumulusVPN:

- **VpnService** declaration (Play requires a video showing the app open and the
  VPN connecting).
- **Foreground service types** declaration (specialUse) — same video suffices.

## What it shows

Captured 2026-07-22 on the `Medium_Phone_API_36.1` emulator (Android 16 /
API 36, 1080×2400) from the **release** APK (`assembleRelease`), end to end, no
cuts:

1. App launched from the home screen → branded splash.
2. **Pre-connection data disclosure** ("Before you connect") — the 5.4 screen.
3. Discovery of the decentralized Flux gateway fleet.
4. **Connect** → the Android system VpnService consent dialog ("Connection
   request… monitor network traffic") → accept.
5. **Connected**: real tunnel up (`tun0` = 10.8.0.x), live exit shown
   (Netherlands / Paris node), key icon in the status bar, download/upload/ping
   and cumulative data ticking.
6. Server list (Choose location) with live latency, then back to the connected
   state.

The tunnel is genuine — the emulator brought up a real WireGuard `tun0` against a
live gateway, so the throughput/ping figures are real (and modest, as expected
through an emulator).

Specs: **59.7 s** (under Play's ~90 s guidance), H.264, 1080×2400, faststart
(moov atom relocated to the front) so it uploads/streams cleanly.

## Submitting it

Play's declaration forms take a **video URL**, not a file upload. Upload this
mp4 to YouTube as **Unlisted** and paste that link into both the VpnService and
Foreground-service-types declarations in the Play Console.

## Regenerating

Rebuild the release APK (`clients/mobile/android` → `./gradlew assembleRelease`),
install on a booted emulator, then drive with `adb shell screenrecord` while
walking the flow above. Re-run faststart:
`ffmpeg -i in.mp4 -c copy -movflags +faststart play-vpnservice-demo.mp4`.

---

# iOS promo video

`ios-promo.mp4` — 40 s marketing/social promo for CumulusVPN iOS (1080×1920,
30 fps, H.264 + AAC, faststart). NOT an App Store Connect "app preview" (those
need exact device sizes, e.g. 886×1920); this is for socials, the site, and
press.

## What it shows

Motion-graphics tour built from the **real iOS captures** in
`../screenshots/raw/ios/` (same provenance as the store screenshots), seated
in the official Apple iPhone 16 Pro Max bezel on the brand sky gradient:

1. Brand intro — glyph, wordmark, "THE DECENTRALIZED VPN".
2. CONNECT — real connected session (Netherlands, physical-device capture).
3. COUNTRIES — country picker with live latency.
4. MULTI-HOP — route-style selector with tradeoff copy.
5. FREE TIER — settings with the honest "100 KB/s" limit row.
6. Outro — "NO ACCOUNT / No logs. Powered by Flux." + cumulusvpn.com.

Copy mirrors `.claude/skills/appstore-screenshots/config/locales/en.yaml`
(the store-approved claims — honesty rule holds).

## Music

Fully synthesized in `ios-promo-src/music.py` (numpy/scipy: maj9 pads, pluck
arp, sub bass, soft four-on-the-floor that drops out for the outro). No
samples, no third-party audio — **zero licensing constraints**.

## Regenerating

```bash
cd "$(mktemp -d)"
uv venv venv && uv pip install -p ./venv/bin/python pillow numpy scipy pyyaml
REPO=<repo-root>
./venv/bin/python "$REPO/store/assets/video/ios-promo-src/music.py"
./venv/bin/python "$REPO/store/assets/video/ios-promo-src/render.py"
ffmpeg -i video-silent.mp4 -i music.wav -c:v copy -c:a aac -b:a 192k \
  -shortest -movflags +faststart "$REPO/store/assets/video/ios-promo.mp4"
```

Requires ffmpeg and macOS (kicker font is system Menlo). Timeline, copy, and
scene order live at the top of `ios-promo-src/render.py`.
