# design

Visual design for CumulusVPN clients.

- **`mockups.html`** — self-contained client UI mockups (connect screen, country picker, FLUX
  payment/upgrade, desktop tray, pricing). Open in a browser or view the published Artifact.
  Theme-aware (light/dark), no external assets.

## Design language (as used in the mockups)

- **Palette:** cool-biased neutrals; primary **cyan `#34E4DA`** = brand / connected state;
  **amber `#F5B23D`** = premium/paid tier; green/slate = connection status. Two accents that each
  carry meaning (connect vs. pay), not decoration.
- **Type:** heavy tight system-grotesque for display, system-sans for body, **monospace for all
  technical data** (IPs, keys, FLUX amounts, memos) — the recurring "crypto-native, precise" motif.
- **Product law:** one screen, one job. Connect button + country list + payment. First launch to
  connected in under 5 seconds.

The mockups are direction, not final UI — they set the palette, type, and screen inventory the
`clients/` apps build against (see `../docs/05-clients.md`).
