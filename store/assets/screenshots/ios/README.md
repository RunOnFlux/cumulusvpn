# iOS store screenshots — PREVIEW PROVENANCE

**These frames seat real app captures — taken on a Pixel 6 Pro (Android
release build, 2026-07-21, raws in `../raw/android/`) — inside the official
iPhone bezel.** The UI is the same React Native code on both platforms, so
they preview the iOS listing faithfully. **Do NOT upload them to App Store
Connect:** Apple review (2.3.3 / 2.3.10) requires captures of the app running
on iOS (the status bar shows Android glyphs on close inspection).

To produce the uploadable set, follow
`.claude/skills/appstore-screenshots/SKILL.md` (Release simulator build;
physical iPhone for the connected-state frame), drop raws in `../raw/ios/`,
regenerate with `python3 compositor.py --locale en`, and replace these files.

Slots: `iphone-6.9/` (1320×2868, master slot), `iphone-6.7/` (1290×2796),
`iphone-6.5/` (1242×2688 — ASC's separate 6.5" slot).
