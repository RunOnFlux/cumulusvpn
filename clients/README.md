# clients

All user-facing apps. Product bar and platform decisions: [`../docs/05-clients.md`](../docs/05-clients.md).

| Dir | Platform | Stack | Phase |
|---|---|---|---|
| `web/` | Browser onboarding + payment page + signed directory | React/Vite, in-browser WG keygen | 0 (ships with gateway MVP) |
| `core-ts/` | Shared TypeScript core (discovery, enroll, status, payment-code) + design system | TS | 1 |
| `desktop/` | Windows / macOS / Linux | Tauri + wireguard-go sidecar | 1 |
| `mobile/` | iOS / Android | React Native + WireGuardKit / wireguard-android:tunnel | 1 |

UX law for every client: one screen — country picker, one connect button, tier badge
("Free · 100 KB/s → Upgrade $0.99"). First launch to connected in under 5 seconds.
