# @cumulusvpn/desktop

CumulusVPN desktop client — **Tauri 2 (Rust shell) + React/TS**, reusing
`@cumulusvpn/core` for keys, discovery, enrollment, payment codes and WireGuard
config. Unlike the web rail, the desktop app **actually tunnels**: it drives a
bundled `wireguard-go` userspace sidecar over its UAPI control socket and
applies a platform kill switch.

## Where the tunnel runs

The tunnel engine (`src-tauri/tunnel`, the `cumulusvpn-tunnel` crate) spawns
`wireguard-go`, edits routes, drives the kill switch and sets DNS. All of that
needs root/Administrator. There is exactly one copy of it, and it normally runs
in the **privileged helper daemon** (`src-tauri/helper`, the `cumulusvpn-helper`
binary), so the app itself runs as a normal user on every desktop OS:

| | Helper runs as | Installed by | App talks to it over | Peer authentication |
|---|---|---|---|---|
| **macOS** | LaunchDaemon (root) | `SMAppService`; the user approves it once in System Settings | `/var/run/cumulusvpn-helper.sock` (0666) | code signature: bundle id + `APPLE_TEAM_ID` (`helper/src/peer.rs`) |
| **Linux** | systemd service `cumulusvpn-helper` (root) | the .deb / .rpm (unit + maintainer scripts in `src-tauri/linux/`) | `/run/cumulusvpn/helper.sock`, `root:cumulusvpn` 0660 | root, or a `cumulusvpn` group member running `/usr/bin/cumulusvpn-desktop` (`SO_PEERCRED` + `/proc/<pid>/exe`, `helper/src/peer_linux.rs`) |
| **Windows** | service `CumulusVPNHelper` (LocalSystem) | the NSIS / MSI installers, per-machine (`src-tauri/windows/`) | `\\.\pipe\CumulusVPN.Helper` (interactive users may connect, not create instances) | an elevated administrator, or `cumulusvpn-desktop.exe` next to the service in Program Files (`helper/src/peer_windows.rs`) |

**Fallback.** An elevated app with no helper to talk to runs the tunnel
in-process instead, which is how every platform worked before the daemon:

| | When | What the UI shows |
|---|---|---|
| macOS | launched as root (`sudo`), e.g. an unsigned build, which cannot register its helper | nothing (`notNeeded`) |
| Linux | run as root and no helper answers at launch — the **AppImage**, which cannot install a system service | a note: the VPN stops when the app quits (`elevated`) |
| Windows | run as Administrator and the service is missing or stopped | the same note (`elevated`) |

Unelevated with no usable helper, the app never fails silently: Connect is
disabled and a banner says what is missing — `serviceNotInstalled` (install the
package / reinstall), `serviceNotRunning` (`sudo systemctl enable --now
cumulusvpn-helper`, or start "CumulusVPN Helper"), `serviceDenied` (Linux: log
out and back in after joining the `cumulusvpn` group; Windows: run the installed
app), or the macOS approval states. `helper_registration` reports these
(`src-tauri/src/backend.rs` → `src/lib/setup.ts`).

The Tauri commands are identical everywhere. `src-tauri/src/backend.rs` sends
them to the helper (`helper_client.rs`) or to the in-process tunnel; both use
the same `cumulusvpn-protocol` request types, and both run the same
roam-repair / dead-tunnel watchdog loop (`spawn_repair_loop`), so recovery never
depends on the webview polling.

### Lifecycle (the same on all three OSes)

* **Quit** from the tray: the app disconnects first (only if something is up),
  then exits. The daemon keeps running.
* **The app is killed** (`kill -9`, `taskkill /F`, a crash): the daemon keeps the
  tunnel, kill switch, DNS and repair loop running. The relaunched app
  **reattaches** to the live session (`reattachPhase` in
  `src/hooks/useConnection.ts`) instead of showing a fresh disconnected state.
* **The daemon is stopped** (`systemctl stop`, `Stop-Service`, upgrade,
  uninstall, shutdown; Linux/Windows): it disconnects before it exits.
* **The daemon dies**: launchd / systemd / the SCM restarts it. On Linux and
  Windows the new instance cleans up after the old one before serving anyone —
  DNS, orphaned `wireguard-go`, and the kill switch (on Windows its
  `DefaultOutboundAction Block` would otherwise even survive a reboot) — and the
  app sees the drop and reconnects. macOS keeps the fail-closed pf anchor until
  then.

### The IPC endpoint is the privilege boundary

Anything that can talk to the helper can ask a privileged process to rewrite
the firewall and the routing table. So every peer is authenticated before a
single request is read, and every request is shape-checked before it touches
anything (`tunnel/src/validate.rs`: endpoints must be `ip:port` literals, routes
must be prefixes, … — they end up in nft/pf rule text and in PowerShell run as
SYSTEM).

* **macOS** proves identity cryptographically: the peer must satisfy a designated
  requirement pinning our bundle id and Team ID (audit token, not pid). File
  permissions could not express "our app and nothing else", so the socket is
  world-connectable on purpose.
* **Linux** draws the boundary at a group, enforced by the kernel through the
  socket's mode, like the docker and libvirt sockets: the postinst creates
  `cumulusvpn` and adds the installing user (`$SUDO_USER`, or `$PKEXEC_UID`).
  Membership applies to new sessions, so **log out and back in once** after the
  first install. A graphical installer cannot tell who installed, so there the
  user adds themselves (`sudo usermod -aG cumulusvpn "$USER"`); the app's banner
  says so.
* **Windows** draws it at the pipe's security descriptor: interactive users may
  read and write, but not create pipe instances, so nobody can pose as the
  service; the app also refuses a pipe not owned by SYSTEM or Administrators,
  and opens it identification-only, so even an impostor could not impersonate
  the user.
  The installers are per-machine because a LocalSystem service must never run a
  binary from a user-writable directory.
* On both, the executable check (the installed app only) is defence in depth,
  not a boundary: a user can always get into their own processes. What an
  allowed user can do is connect, disconnect and read status — what the app does.
  Windows Authenticode pinning is a prepared seam (`REQUIRE_AUTHENTICODE`), off
  until Windows builds are signed.

### Installing and removing the daemon

* **macOS**: `tauri.macos.conf.json` bundles the helper and its plist in the
  .app; the app registers it with `SMAppService` at launch.
* **Linux** (`tauri.linux.conf.json`): the .deb and .rpm ship
  `/usr/bin/cumulusvpn-helper` and
  `/usr/lib/systemd/system/cumulusvpn-helper.service`. postinst / `%post`:
  create the group, add the installing user, `daemon-reload`, `enable`,
  `restart`. prerm / `%preun` on removal: stop (which disconnects), disable,
  `cumulusvpn-helper --cleanup`. postrm / `%postun`: `daemon-reload` (on rpm
  upgrade, `try-restart`). The group is left in place on removal. The AppImage
  has no service (see the fallback above).
* **Windows** (`tauri.windows.conf.json`): the NSIS hooks (`windows/hooks.nsh`)
  stop the service before files are replaced, install `cumulusvpn-helper.exe`
  next to the app, and register it (`sc create` / `sc config`, automatic start,
  quoted path, restart on failure); uninstall stops it, runs `--cleanup` and
  deletes it. The MSI does the same with native `ServiceInstall` /
  `ServiceControl` tables and a cleanup custom action
  (`windows/helper-service.wxs`).

`cumulusvpn-helper --ping` (Linux, Windows) asks the running daemon for its
version as the calling process, or prints why it would not serve it.
`--cleanup` undoes what a crashed session left behind (refused while a daemon
answers). Windows also has `--console` for debugging (elevated, service stopped).

## DNS

While the tunnel is up, the **system resolver is the tunnel's** — the `DNS =`
from the gateway's enroll reply (`1.1.1.1` today, reached through the tunnel) —
so no lookup goes to the router or the ISP. It is applied last on connect (after
the routes point into the tunnel; on the exit device for multi-hop), re-asserted
by the repair loop, and restored first on disconnect. All of it lives in
`src-tauri/tunnel/src/dns.rs` behind one small interface (`DnsSession::start` /
`reassert` / `restore`, plus `recover_stale` at startup), shared by the helper
daemon on every OS and the in-process fallback.

| OS | How | Restore / crash |
|---|---|---|
| **macOS** | SystemConfiguration dynamic store via `scutil`: `ServerAddresses` overridden in every `State:/Network/Service/*/DNS` **and** `Setup:/…/DNS` key (manual servers in `Setup:` win over DHCP, so both are needed); nothing written to disk preferences. Each original is copied exactly to `State:/Network/CumulusVPN/Backup/…` first. The repair loop re-takes any key the OS republishes after a roam or DHCP renewal. | Backups are put back only over keys that still carry our `CumulusVPNOverride` marker. They live in the dynamic store, so a killed helper restores them when launchd restarts it, and a reboot leaves nothing stale. |
| **Linux** | systemd-resolved when it is the system resolver: `resolvectl dns <if> <ip>`, `domain <if> '~.'`, `default-route <if> true`. Otherwise `resolvconf -a <if> -m 0 -x` (as `wg-quick`). Neither available → a DNS warning in the UI, never a silent leak. | resolved per-link config dies with the link. A stale resolvconf record is removed when the daemon (or the in-process app) next starts. |
| **Windows** | The wintun adapter gets the server, interface metric 1 and an empty suffix; the `CumulusVPN-DNS` firewall group blocks DNS (53/853, UDP+TCP) to every server but the tunnel's and from every address but the tunnel's, which stops smart multi-homed resolution asking the other adapters. Applied whether or not the kill switch is on. | Only our rule group is removed; the default outbound policy is never touched, so quitting an app that never connected still leaves the firewall alone. Stale rules are removed when the service (or the in-process app) next starts. |

**Kill switch on:** pf / nftables / Windows Firewall also drop all DNS except to
the tunnel resolver through the tunnel, ordered (or, on Windows, expressed as
block rules) so a LAN bypass cannot reopen DNS to the router. IPv6 resolvers on
the physical link are covered too — the tunnel carries no IPv6.

**Split tunneling:** tunnel DNS for everything, bypassed prefixes included; with
split routing active the resolver also gets a host route through the tunnel, so
neither an exclusion that covers it nor include mode sends it out in the clear.
`excludedDns: 'system'` has no effect on the desktop until domain/app rules ship.

**When DNS cannot be set** the tunnel stays up and its status carries
`dnsWarning`, shown as an amber banner under the orb — never a clean
"protected". Hardware verification: `docs/16-validation.md`, Stage F-DNS.

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
  src/backend.rs         one interface: helper daemon or in-process tunnel,
                         and the setup state the UI shows
  src/helper_client.rs   IPC client to the helper (Unix socket / named pipe),
                         incl. checking the other end is the real helper
  src/helper_install.rs  macOS: SMAppService registration + approval deep link
  src/platform.rs        Linux/Windows: service installed? app elevated?
  protocol/              request/status types (helper wire format + in-process
                         API) and the per-OS endpoint names
  tunnel/                the tunnel engine, shared by the helper and the app
    src/lib.rs           TunnelManager — owns sidecar + kill switch + state,
                         the repair/watchdog loop and startup recovery
    src/validate.rs      shape checks on every request (privilege boundary)
    src/wggo.rs          wireguard-go spawn + .conf → UAPI translation
    src/routing.rs       routes / addresses (route, ip, netsh)
    src/dns.rs           system resolver → tunnel resolver (scutil, resolvectl /
                         resolvconf, PowerShell + firewall), restore, recovery
    src/killswitch.rs    pf / nftables / WFP leak protection (incl. DNS)
    src/tlsbridge.rs     wg-tls UDP<->TLS bridge
  helper/                the privileged daemon (macOS, Linux, Windows)
    src/main.rs          entry point per OS + packaging guard tests
    src/server.rs        request server: authenticate, then dispatch (any
                         stream); the Unix socket listener
    src/peer.rs          macOS: code-signature authentication + APPLE_TEAM_ID
    src/linux.rs         Linux: systemd daemon, socket perms, SIGTERM teardown,
                         --cleanup / --ping
    src/peer_linux.rs    Linux: group + SO_PEERCRED + executable check
    src/windows.rs       Windows: service control dispatcher, --console /
                         --cleanup / --ping
    src/pipe.rs          Windows: named-pipe listener + security descriptor
    src/peer_windows.rs  Windows: elevation / installed-image check, SDDL,
                         Authenticode seam
    launchd.plist        the LaunchDaemon SMAppService registers
  linux/                 systemd unit + deb/rpm maintainer scripts
  windows/               NSIS installer hooks + MSI service fragment
  tauri.macos.conf.json  macOS: builds + bundles the helper (.app)
  tauri.linux.conf.json  Linux: builds the helper, ships it + the unit in
                         the .deb/.rpm with the maintainer scripts
  tauri.windows.conf.json Windows: builds the helper, per-machine NSIS with
                         hooks, MSI fragment, wintun.dll
scripts/build-helper.mjs builds + stages the helper for the bundlers (all OSes)
```

## Scripts

| Command | What it does |
|---|---|
| `yarn typecheck` | `tsc --noEmit` over the frontend |
| `yarn build` | type-check + `vite build` → `dist/` (runs in CI) |
| `yarn dev` | Vite dev server on `:1420` |
| `yarn tauri:dev` | full native app in dev (needs Rust toolchain) |
| `yarn tauri:build` | installers (needs Rust + platform SDKs); on every OS it builds and stages the helper first (`scripts/build-helper.mjs`, the platform's `beforeBuildCommand`) |

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

### Developing on Linux and Windows

`tauri dev` puts the app at `src-tauri/target/debug/cumulusvpn-desktop[.exe]`;
build the helper into the same directory (`cargo build -p cumulusvpn-helper`)
and it serves that app, since it accepts the app sitting next to it.

* **Linux**: `sudo groupadd --system cumulusvpn; sudo usermod -aG cumulusvpn
  "$USER"` (log in again), then `sudo ./target/debug/cumulusvpn-helper` and
  `yarn tauri:dev`. Or skip the helper: run the app as root.
* **Windows**: from an elevated prompt, with any installed `CumulusVPNHelper`
  service stopped, `target\debug\cumulusvpn-helper.exe --console`; then
  `yarn tauri:dev` from a normal prompt. Or run the app as Administrator.

### Signing (macOS)

`SMAppService` will not register an unsigned daemon, and the helper refuses
peers that fail its designated requirement — so an ad-hoc build cannot complete
setup. Sign inner-out after bundling:

```bash
APPLE_SIGNING_IDENTITY="Developer ID Application: … (TEAMID)" \
  bash scripts/sign-macos.sh
```

`TEAMID` must equal `APPLE_TEAM_ID` in `src-tauri/helper/src/peer.rs`, the one
place it is defined (currently `276MY32G8B`, the US company's Apple team, which
holds the Developer ID Application certificate; the iOS app is still signed by
the UK team `URVD95GYQ7` until its transfer, and that is unrelated). If they
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

**The helper's Linux and Windows halves are new and not yet hardware-verified.**
The request path, the Linux peer policy and the socket server are tested in
Linux CI; the named-pipe server runs its tests on a Windows runner; and the
release workflow installs and removes the .deb, the NSIS and the MSI build on
its runners, checking the service, its permissions and peer refusal. No tunnel
has been brought up through either daemon yet. See Stages H, I, J and K in
`docs/16-validation.md` for what has and has not been verified.
