# Store Assets Checklist (CumulusVPN)

Status legend: **[done]** produced in this repo · **[todo]** needs a device/simulator screenshot
or a human step. Generated icon/graphic files live under `store/assets/`.

Brand masters: `brand/{icon.svg, icon-background.svg, icon-foreground.svg, wordmark.svg}`
(cumulus cloud + Flux bolt; cyan #34E4DA / #0FB9AE, amber #F5B23D, ink #0C1420).

---

## 1. App icons

### iOS
| Purpose | Size (px) | File | Status |
|---|---|---|---|
| App Store marketing icon (no alpha, flattened) | 1024×1024 | `store/assets/icon/ios-appstore-1024.png` | **[done]** |
| iPhone app @3x | 180×180 | `store/assets/icon/ios-180.png` | **[done]** |
| iPad Pro app @2x | 167×167 | `store/assets/icon/ios-167.png` | **[done]** |
| iPad app @2x | 152×152 | `store/assets/icon/ios-152.png` | **[done]** |
| Spotlight/Settings set | 120/87/80/76/60/58/40 | `store/assets/icon/ios-*.png` | **[done]** |

Modern Xcode accepts a **single 1024×1024** in the asset catalog (single-size App Icon) and
generates the rest; all sizes are provided anyway for older catalogs. The 1024 is flattened onto
the ink background with **no alpha channel** (Apple rejects alpha in the marketing icon) — verified.

### Android
| Purpose | Size (px) | File | Status |
|---|---|---|---|
| Play Store listing icon (32-bit PNG w/ alpha) | 512×512 | `store/assets/icon/play-icon-512.png` | **[done]** |
| Adaptive icon — foreground (108dp) | 432×432 | `store/assets/icon/android-adaptive-foreground-432.png` | **[done]** |
| Adaptive icon — background (108dp) | 432×432 | `store/assets/icon/android-adaptive-background-432.png` | **[done]** |
| Legacy launcher mipmaps | 192/144/96/72/48 | `store/assets/icon/android-launcher-*.png` | **[done]** |

Adaptive icon: the glyph sits inside the 66dp safe zone in `icon-foreground.svg`; system masks
(circle/squircle/rounded-square) will not clip it. Wire these into
`clients/mobile/android/app/src/main/res/mipmap-*` at build time.

## 2. Feature graphic (Play, required)
| Purpose | Size (px) | File | Status |
|---|---|---|---|
| Play feature graphic | 1024×500 | `store/assets/play-feature-graphic-1024x500.png` | **[done]** |

Composed from the wordmark + glyph on the ink gradient with the amber "Powered by the Flux
network" line. No alpha (Play accepts JPG/PNG; provided as flattened PNG).

## 3. Screenshots — REQUIRED, still [todo] (need a running app on a device/simulator)

Screenshots must be **real captures of the app UI**. The app screens exist
(`design/mockups.html`, `clients/mobile/`). Capture on the simulator/emulator once a build runs,
then drop into `store/assets/screenshots/{ios,android}/`.

### iOS (App Store Connect) — portrait
| Display class | Device to capture on | Pixel size (portrait) | Count | Status |
|---|---|---|---|---|
| 6.7" iPhone (required) | iPhone 15/16 Pro Max, 15 Plus | **1290×2796** | 3–10 | **[todo]** |
| 6.5" iPhone (recommended fallback) | iPhone 11 Pro Max / XS Max | **1242×2688** | 3–10 | **[todo]** |
| 5.5" iPhone (only if supporting old devices) | iPhone 8 Plus | **1242×2208** | 3–10 | **[todo]** |
| iPad Pro 12.9" (required if app is universal/iPad) | iPad Pro 12.9" | **2048×2732** | 3–10 | **[todo]** |

Apple's current minimum is a 6.7"/6.9" set; the 6.5"/5.5" sets are optional if you only upload
the largest and let Apple downscale. Provide iPad only if the binary ships iPad support.

### Android (Play Console)
| Type | Size / rule | Count | Status |
|---|---|---|---|
| Phone screenshots (required) | 16:9 or 9:16; min side ≥ 320px, max ≥ 3840px; e.g. **1080×1920** | 2–8 (min 2) | **[todo]** |
| 7" tablet (optional) | up to 3840px, e.g. **1200×1920** | up to 8 | **[todo]** |
| 10" tablet (optional) | up to 3840px, e.g. **1600×2560** | up to 8 | **[todo]** |

### Suggested screenshot storyboard (both stores, 5 frames)
1. Connected hero — big connect button, country flag, "Connected · Frankfurt".
2. Country picker with live latency dots.
3. Tier line — "Free · 100 KB/s" (honest, no purchase UI on mobile).
4. Multi-hop toggle screen with the honest tradeoff copy.
5. "No account. No logs. Powered by Flux." brand/value frame.

## 4. Other listing graphics
| Asset | Store | Requirement | Status |
|---|---|---|---|
| App preview video | iOS | Optional (15–30s .mov/.mp4) | **[todo] optional** |
| Promo video (YouTube URL) | Play | Optional | **[todo] optional** |
| TV/wear/auto assets | both | N/A (phone/tablet only) | n/a |

## 5. Regeneration commands (icons + feature graphic)
All generated deterministically from the brand SVGs with `rsvg-convert` + `magick`:
```bash
# from repo root
brand=brand; out=store/assets/icon
rsvg-convert -w 1024 -h 1024 $brand/icon.svg | \
  magick - -background '#0B1424' -alpha remove -alpha off $out/ios-appstore-1024.png
for s in 180 167 152 120 87 80 76 60 58 40; do rsvg-convert -w $s -h $s $brand/icon.svg -o $out/ios-$s.png; done
rsvg-convert -w 512 -h 512 $brand/icon.svg -o $out/play-icon-512.png
for s in 192 144 96 72 48; do rsvg-convert -w $s -h $s $brand/icon.svg -o $out/android-launcher-$s.png; done
rsvg-convert -w 432 -h 432 $brand/icon-foreground.svg -o $out/android-adaptive-foreground-432.png
rsvg-convert -w 432 -h 432 $brand/icon-background.svg -o $out/android-adaptive-background-432.png
# feature graphic source is store/assets (see docs/12)
```
(For the iOS `.appiconset`/`.xcassets` and Android `mipmap` wiring, see docs/12.)
