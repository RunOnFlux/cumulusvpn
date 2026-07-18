# 13 — iOS build: the WireGuardKit blockers (diagnosis + fix)

Status as of 2026-07-17: **ALL THREE blockers cleared — iOS BUILD SUCCEEDED** (device `iphoneos`,
unsigned) on Xcode 26 / iOS 26.5 SDK. The `CumulusVPN.app` and `PacketTunnelExtension.appex` (real
WireGuard engine linked) are produced. iOS now builds alongside desktop and Android.

The original agent diagnosis was partly wrong — recording the **verified** truth + the exact
reproducible recipe here.

## Confirmed working recipe (device, unsigned — proves the link)

1. Vendored + patched `wireguard-apple` (see Fix 1a) — DONE, in repo.
2. Build the Go archive with Go 1.22 (`go install golang.org/dl/go1.22.10@latest && go1.22.10 download`):
   ```
   cd clients/mobile/ios/vendor/wireguard-apple/Sources/WireGuardKitGo
   PATH="$(go1.22.10 env GOROOT)/bin:$PATH" make build \
     ARCHS=arm64 PLATFORM_NAME=iphoneos SDKROOT="$(xcrun --sdk iphoneos --show-sdk-path)"
   # → out/libwg-go.a  (3.2 MB arm64; exports _wgTurnOn/_wgVersion/_wgSetLogger)
   ```
   The `goruntime-boottime-over-monotonic.diff` applies cleanly to Go 1.22 — **blocker 2 cleared.**
3. Build + link:
   ```
   cd clients/mobile/ios
   xcodebuild -workspace CumulusVPN.xcworkspace -scheme CumulusVPN \
     -sdk iphoneos -destination 'generic/platform=iOS' -configuration Debug \
     CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO \
     SWIFT_ENABLE_EXPLICIT_MODULES=NO ARCHS=arm64 ONLY_ACTIVE_ARCH=YES \
     LIBRARY_SEARCH_PATHS="\$(inherited) $PWD/vendor/wireguard-apple/Sources/WireGuardKitGo/out" \
     build
   # → ** BUILD SUCCEEDED **  (CumulusVPN.app + PlugIns/PacketTunnelExtension.appex)
   ```
   Harmless warning: `object file built for newer 'iOS' version (26.5) than being linked (15.1)` —
   silence it by passing the deployment target into the Go build if desired.

## What actually happens (verified by building)

An unsigned simulator build (`xcodebuild -scheme CumulusVPN -sdk iphonesimulator … CODE_SIGNING_ALLOWED=NO`)
progresses like this, in order:

1. ❌→✅ **WireGuardKitC clang module fails to compile** — `declaration of 'u_int16_t' must be
   imported from module '_DarwinFoundation1.unsigned_types' before it is required`
   (`WireGuardKitC.h`, `struct sockaddr_ctl`). This is Xcode 26's strict Clang **explicit modules**,
   *not* a missing `#include` (the header already has `<sys/types.h>`). **THE REAL BLOCKER.**
2. ✅ WireGuardKit + WireGuardKitGo Swift/C compile.
3. ❌ **`ld: library 'wg-go' not found`** when linking `PacketTunnelExtension` — the Go static
   archive `libwg-go.a` was never built (SPM can't run the WireGuardKitGo Makefile).

## Fix 1 (blocker 1) — the module error — SOLVED, proven

Two changes make WireGuardKit compile cleanly under the iOS 26.5 SDK:

**a. Patch `Sources/WireGuardKitC/WireGuardKitC.h`** — replace the BSD type aliases with C99
fixed-width types (ABI-identical, but module-clean so the strict Darwin submodule import isn't
required):
```c
struct ctl_info    { uint32_t ctl_id;  char ctl_name[96]; };
struct sockaddr_ctl{ uint8_t sc_len; uint8_t sc_family; uint16_t ss_sysaddr;
                     uint32_t sc_id; uint32_t sc_unit; uint32_t sc_reserved[5]; };
```
(`u_int32_t`→`uint32_t`, `u_int16_t`→`uint16_t`, `u_char`→`uint8_t`.)

**b. Build setting** `SWIFT_ENABLE_EXPLICIT_MODULES = NO` on the `CumulusVPN` and
`CumulusTunnelExtension` targets (routes Swift back to implicit module builds).

With both, `grep -c "must be imported from module"` on the build log drops from 3 to **0** and the
build proceeds to the link stage. **Verified.**

Persistence: since WireGuardKit is an SPM dependency (checkout under DerivedData is ephemeral), the
header patch must live in a **vendored copy**. **DONE:** `github.com/WireGuard/wireguard-apple` is
vendored at pinned `10da5cfdef362889b438cfbeff867a74e6d717fd` in
`clients/mobile/ios/vendor/wireguard-apple`, with patch (a) already applied to its
`Sources/WireGuardKitC/WireGuardKitC.h`. **REMAINING:** repoint the Xcode SPM reference from the git
URL to that local path (`XCRemoteSwiftPackageReference` → local package), so the build uses the
patched copy instead of re-fetching the upstream one.

## Fix 2 (blocker 3) — build `libwg-go.a` — the one remaining step

`WireGuardKitGo/Makefile` builds the Go c-archive (`go build -buildmode c-archive`). SPM never runs
it, so the linker can't find `-lwg-go`. Two parts:

- **Go toolchain (blocker 2):** the module set is 2021-era (`go.mod` says `go 1.17`); Go 1.26's
  `//go:linkname` tightening breaks it. Build with **Go 1.22** (`go install golang.org/dl/go1.22.10@latest
  && go1.22.10 download`).
- **Wire it as an Xcode build phase:** add a pre-build **Run Script** phase to `CumulusTunnelExtension`
  that runs the Makefile with Xcode's env (Xcode passes `ARCHS`/`SDKROOT`/`PLATFORM_NAME`/
  `CONFIGURATION_BUILD_DIR`), so `libwg-go.a` lands on the linker search path. This is exactly what
  wireguard-apple's own demo app project does — pure SPM can't, which is why blocker 1 existed.

Manual archive build (device path; the real submission build runs this via the build phase with the
human's Xcode + Apple account):
```
cd <vendor>/wireguard-apple/Sources/WireGuardKitGo
PATH="$(dirname $(go1.22.10 env GOROOT))/go1.22.10/bin:$PATH" \
  make build ARCHS=arm64 PLATFORM_NAME=iphoneos \
  SDKROOT="$(xcrun --sdk iphoneos --show-sdk-path)" \
  CONFIGURATION_BUILD_DIR=<Build/Products dir>
```
Note: the Makefile only maps `macosx`/`iphoneos` → GOOS; add `GOOS_iphonesimulator := ios` for
simulator builds. Building the Go c-archive for the **simulator** specifically is finicky (Go's
`ios/arm64` targets the device); the **device** build is the standard, well-trodden path and is what
ships — so wire the build phase and build for `iphoneos` with the human's signing.

## Bottom line

- **iOS builds** — `** BUILD SUCCEEDED **`, app + Packet Tunnel extension with the real WireGuard
  engine linked. All three blockers cleared and verified.
- **Persistence wiring (to make a plain `xcodebuild` / the signed build "just work")** — **APPLIED**
  to the project file via `scripts/apply-build-wiring.rb` (idempotent; re-run any time). It performs:
  1. Repoints the Xcode SPM reference to the local vendored `wireguard-apple` (so Fix 1a's header
     patch is used automatically instead of a re-fetched upstream checkout) — the package reference
     is now an `XCLocalSwiftPackageReference` → `vendor/wireguard-apple`, and the `PacketTunnelExtension`
     `WireGuardKit` product dependency points at it.
  2. Sets `SWIFT_ENABLE_EXPLICIT_MODULES = NO` on both targets and adds `$(CONFIGURATION_BUILD_DIR)`
     to the extension's `LIBRARY_SEARCH_PATHS` (instead of `xcodebuild` flags).
  3. Adds a first (pre-link) Run Script build phase "Build libwg-go.a" to `CumulusTunnelExtension`
     that runs the WireGuardKitGo Makefile — the standard wireguard-apple pattern. **You still need
     Go 1.22 on PATH** for that phase (Go 1.26 breaks the pinned build); the Xcode Cloud
     `ci_post_clone.sh` provisions it, and a local Xcode build needs it too.

  What remains is entirely on your Mac: open the project, let SPM resolve the local package, and do
  the signed device build with your Apple Developer account. (A stale remote pin may linger in
  `Package.resolved`; Xcode reconciles it to the local package on first resolve.)
- The signed device/store build (the human's Mac + Apple Developer account) then produces the
  archive and links it exactly as proven above — this is the normal iOS-WireGuard path.

## Multi-hop (nested) tunnel — Wgnest.xcframework

True multi-hop on iOS runs the shared Go core `clients/native/wgnest` (two stacked wireguard-go
devices; see `docs/11-multihop.md`) inside the Packet Tunnel extension, because WireGuardKit's
`WireGuardAdapter` binds exactly one device to the tun. It ships as a gomobile-built xcframework:

- **Build:** `bash clients/native/wgnest/build-ios.sh` → `clients/mobile/ios/Frameworks/Wgnest.xcframework`
  (device + simulator slices, ~43 MB, gitignored). Needs **Go ≥ 1.23** — build it *before* the Go
  1.22 symlink that WireGuardKit's `libwg-go.a` needs (the Xcode Cloud `ci_post_clone.sh` does this
  ordering; do the same locally).
- **Wiring:** `ruby clients/mobile/ios/scripts/add-wgnest-framework.rb` links + embeds the
  xcframework into `PacketTunnelExtension` and adds `FRAMEWORK_SEARCH_PATHS` (idempotent). Already
  applied to the project file.
- **Seam:** `PacketTunnelProvider.startMultihop` builds `NEPacketTunnelNetworkSettings` (exit
  address, exit DNS, MTU 1340, `excludedRoutes = entryIP/32` so the outer socket bypasses the tun),
  finds the utun fd (the WireGuardKit getpeername scan), and calls `WgmobileStart(…, tunFd)`. Stop
  calls `WgmobileStop(handle)`.
- **Note:** the extension now hosts gVisor netstack + two wireguard-go devices — heavier than
  single-hop. Watch the NEPacketTunnelProvider memory budget on-device; if tight, drop the
  simulator slice and profile.
