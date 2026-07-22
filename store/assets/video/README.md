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
