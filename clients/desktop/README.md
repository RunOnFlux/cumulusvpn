# @cumulusvpn/desktop

CumulusVPN desktop client — **Tauri 2 (Rust shell) + React/TS**, reusing
`@cumulusvpn/core` for keys, discovery, enrollment, payment codes and WireGuard
config. Unlike the web rail, the desktop app **actually tunnels**: it drives a
bundled `wireguard-go` userspace sidecar over its UAPI control socket and
applies a platform kill switch.

## Where the tunnel runs

The tunnel engine (`src-tauri/tunnel`, the `cumulusvpn-tunnel` crate) spawns
`wireguard-go`, edits routes and drives the kill switch. All of that needs
root/Administrator. There is exactly one copy of it, and which process runs it
depends on the OS:

| | Runs the tunnel | Privilege | Setup |
|---|---|---|---|
| **macOS** | the `cumulusvpn-helper` LaunchDaemon (root) | app is unprivileged | approve the helper once in System Settings |
| **Linux** | the app process itself | launch the app as root | none |
| **Windows** | the app process itself | run as Administrator (checked up front) | none |
| **macOS, launched as root** | the app process itself | `sudo` | none (the helper is not used) |

The Tauri commands are identical on every OS. `src-tauri/src/backend.rs` sends
them to the helper socket on macOS and to the in-process tunnel elsewhere. Both
paths use the same `cumulusvpn-protocol` request types, and both run the same
roam-repair / dead-tunnel watchdog loop (`spawn_repair_loop`), so recovery never
depends on the webview polling. The `helper_registration` command reports
`notNeeded` on Linux and Windows, so the UI never shows the helper-setup banner
there.

### macOS: the privileged helper

On macOS the app runs **unprivileged** and drives the helper over a Unix
socket. That is why CumulusVPN is not launched with `sudo`. The helper ships
inside the app bundle and is registered with `SMAppService`, so the user approves
it once in **System Settings → General → Login Items & Extensions** and never
sees a password prompt again.

The socket is the privilege boundary: anything that can talk to it can ask a root
process to rewrite the firewall. It is world-connectable *only* because every
peer is authenticated by code signature first (`helper/src/peer.rs`) — file
permissions cannot express "our app and nothing else" when the app runs as
whichever human is logged in.

The daemon also owns recovery: roam repair and the dead-tunnel watchdog run on
its own thread, so a laptop that changes Wi-Fi keeps healing whether the app is
in the foreground, hidden in the tray, or not running at all. On Linux and
Windows the same loop runs on a thread in the app. It keeps working with the
window hidden in the tray, but not after the app quits (quitting disconnects).

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
src-tauri/               Rust workspace
  src/lib.rs             Tauri builder, tray, plugins, command wiring
  src/commands.rs        connect(country, …) / disconnect() / status()
  src/backend.rs         one interface: helper (macOS) or in-process tunnel
  src/helper_client.rs   macOS: IPC client to the helper daemon
  src/helper_install.rs  macOS: SMAppService registration + approval deep link
  protocol/              request/status types (helper wire format + in-process API)
  tunnel/                the tunnel engine, shared by the helper and the app
    src/lib.rs           TunnelManager — owns sidecar + kill switch + state,
                         plus the repair/watchdog loop
    src/wggo.rs          wireguard-go spawn + .conf → UAPI translation
    src/routing.rs       routes / addresses (route, ip, netsh)
    src/killswitch.rs    pf / nftables / WFP leak protection
    src/tlsbridge.rs     wg-tls UDP<->TLS bridge
  helper/                macOS privileged daemon — runs the tunnel as root
    src/main.rs          entry point (prints "macOS only" and exits elsewhere)
    src/server.rs        socket server: authenticate, then dispatch
    src/peer.rs          code-signature authentication + APPLE_TEAM_ID
    launchd.plist        the LaunchDaemon SMAppService registers
  tauri.macos.conf.json  macOS-only: builds + bundles the helper
  tauri.windows.conf.json Windows-only: bundles wintun.dll
```

## Scripts

| Command | What it does |
|---|---|
| `yarn typecheck` | `tsc --noEmit` over the frontend |
| `yarn build` | type-check + `vite build` → `dist/` (runs in CI) |
| `yarn dev` | Vite dev server on `:1420` |
| `yarn tauri:dev` | full native app in dev (needs Rust toolchain) |
| `yarn tauri:build` | installers (needs Rust + platform SDKs); on macOS it builds and stages the helper first (`tauri.macos.conf.json`) |

### Developing on macOS

`tauri dev` runs the app outside a bundle, so `SMAppService` cannot find the
helper and reports `notFound`. Run the helper by hand instead. A **debug**
helper skips the peer check, and the app counts a helper that answers as ready
whatever the registration says:

```bash
cd src-tauri && cargo build -p cumulusvpn-helper
sudo ./target/debug/cumulusvpn-helper     # leave running
yarn tauri:dev                           # in another terminal
```

Alternatively, launch the app as root (`sudo`). That skips the helper entirely
and runs the tunnel in-process, which is how macOS worked before the helper.

### Signing (macOS)

`SMAppService` will not register an unsigned daemon, and the helper refuses
peers that fail its designated requirement — so an ad-hoc build cannot complete
setup. Sign inner-out after bundling:

```bash
APPLE_SIGNING_IDENTITY="Developer ID Application: … (TEAMID)" \
  bash scripts/sign-macos.sh
```

`TEAMID` must equal `APPLE_TEAM_ID` in `src-tauri/helper/src/peer.rs`, the one
place it is defined (currently `URVD95GYQ7`, the company's Apple team). If they
differ, the app and its own daemon refuse to talk to each other, so
`sign-macos.sh` checks this and refuses an identity from any other team. Debug
builds of the helper skip the peer check so development works without a
certificate; release builds always enforce it.

**Unsigned builds** (what CI produces today, since Apple signing is off) cannot
register the helper. The app shows the helper-setup banner, typically "macOS
could not verify CumulusVPN's network helper — try reinstalling." (`notFound`),
and Connect stays disabled. Launched as root (`sudo
/Applications/CumulusVPN.app/Contents/MacOS/cumulusvpn-desktop`), the same build
works, using the in-process tunnel.

**Minimum macOS is 13.0** — `SMAppService` requires it.

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

**The helper is macOS only, by design.** On Linux and Windows the app runs the
tunnel in-process and must itself be elevated (root / Administrator). An
unprivileged path there would need a Windows service registered by the installer,
or a polkit policy / `setcap` on Linux; neither exists yet. The `cumulusvpn-helper`
binary still compiles on those platforms (so the workspace builds and its
socket-server tests run on Linux CI), but it only prints that it is macOS-only
and exits. See Stages H and I in `docs/16-validation.md` for what has and has not
been verified.
