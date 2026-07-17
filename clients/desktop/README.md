# @cumulusvpn/desktop

CumulusVPN desktop client — **Tauri 2 (Rust shell) + React/TS**, reusing
`@cumulusvpn/core` for keys, discovery, enrollment, payment codes and WireGuard
config. Unlike the web rail, the desktop app **actually tunnels**: it drives a
bundled `wireguard-go` userspace sidecar over its UAPI control socket and
applies a platform kill switch.

## Layout

```
src/                     React tray window (Vite)
  App.tsx                one-screen shell: orb, country picker, tier, upgrade
  hooks/useConnection.ts connect/disconnect state machine + status polling
  lib/
    tauri.ts             typed bridge to the Rust commands (+ browser mock)
    session.ts           core-driven discover → enroll → buildWgConfig → connect
    directory.ts         bundled signed directory snapshot + country metadata
    storage.ts           device keypair persistence
  components/            ConnectOrb, CountryPicker, TierBadge, StatBar
src-tauri/               Rust shell
  src/lib.rs             Tauri builder, plugins, managed state, command wiring
  src/commands.rs        connect(country, …) / disconnect() / status()
  src/tunnel/
    mod.rs               TunnelManager — owns sidecar + kill switch + state
    wggo.rs              wireguard-go spawn + .conf → UAPI translation
    killswitch.rs        pf / nftables / WFP leak protection
```

## Scripts

| Command | What it does |
|---|---|
| `yarn typecheck` | `tsc --noEmit` over the frontend |
| `yarn build` | type-check + `vite build` → `dist/` (runs in CI) |
| `yarn dev` | Vite dev server on `:1420` |
| `yarn tauri:dev` | full native app in dev (needs Rust toolchain) |
| `yarn tauri:build` | signed installers (needs Rust + platform SDKs) |

The frontend runs standalone in a browser: outside a Tauri window the native
bridge falls back to an in-memory mock tunnel, so the whole UI is exercisable
without the Rust side.

## POC seams

The data plane is structured with real signatures and clear `// POC:` markers:
process spawn of the sidecar, UAPI socket IO, TUN addressing/routing, the kill
switch backends, the Tauri updater, and the pinned directory signature. The
`.conf` → UAPI `set` translation and config parsing are fully implemented. A
real machine (Rust toolchain + vendored `wireguard-go` + signing) is required
for `tauri:build`.
