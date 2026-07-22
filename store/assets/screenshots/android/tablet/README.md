# Android tablet store screenshots — REAL CAPTURES

Real device captures from the **Medium Tablet AVD** (2560×1600 landscape,
Android 15 / API 35, `google_apis_playstore` arm64), running a **release build**
(`assembleRelease`, local debug signing), 2026-07-22. Raws live in
`../../raw/android-tablet/`.

Four landscape frames, **2560×1600 RGB** (Play-compliant: each side 320–3840px,
longer side ≤ 2× shorter; no alpha), **unframed** at exact display resolution —
Play accepts unframed screenshots, and there is no tablet bezel in the
`playstore-screenshots` compositor (the same unframed approach used for the
13" iPad set on the App Store side).

| Frame | Screen |
|-------|--------|
| `01-connect.png`   | ConnectScreen — tap-to-connect hero, Fast mode, kill-switch + server rows |
| `02-countries.png` | Choose location — country list with flags, node counts, latency badges |
| `03-tier.png`      | Settings — free-tier plan / upgrade + About (version reads **1.0.2**) |
| `04-multihop.png`  | ConnectScreen — multi-hop routing, entry/exit selector, tradeoff copy |

Status bar overridden to 09:41 / full wifi / 100% battery via SystemUI demo
mode. Upload to the Play Console **tablet** screenshot slots (7-inch + 10-inch).

Note: the About-row version is now sourced from `package.json` (was previously a
hardcoded `0.1.0` literal in `SettingsScreen.tsx`) — see that file + the
`package.json` version bump to 1.0.2.
