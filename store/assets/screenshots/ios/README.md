# iOS store screenshots — PREVIEW PROVENANCE

**These frames are composed from `design/mockups.html` captures, not from the
running app.** They exist so the listing composition/copy can be reviewed and
iterated. **Do NOT upload them to App Store Connect** — Apple review (2.3.3 /
2.3.10) requires screenshots that accurately depict the shipping app, and the
mockup differs in detail (e.g. the connect frame shows a PREMIUM pill).

Frame `04-multihop` is absent: the multi-hop selector exists only in the real
app, not in the mockups.

To produce the real set, follow `.claude/skills/appstore-screenshots/SKILL.md`
(Release simulator build; physical iPhone for the connected-state frame), then
regenerate with `python3 compositor.py --locale en` and replace these files.

Slots: `iphone-6.9/` (1320×2868, master slot), `iphone-6.7/` (1290×2796),
`iphone-6.5/` (1242×2688 — ASC's separate 6.5" slot).
