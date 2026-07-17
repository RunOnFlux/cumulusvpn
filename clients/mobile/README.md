# @cumulusvpn/mobile

CumulusVPN mobile client — **React Native (TypeScript)** for iOS + Android.
Connect-only, store-compliant build. Shares `@cumulusvpn/core` for discovery,
enrollment, status and payment-code logic.

## Standalone by design

React Native + Yarn workspaces (and PnP) is brittle, so this app is **not** a
root workspace. It depends on core via `"@cumulusvpn/core": "file:../core-ts"`
and has its own lockfile + `.yarnrc.yml` (`node-modules` linker). Build core
first so `dist/` exists:

```bash
cd ../core-ts && yarn build
cd ../mobile && yarn install && yarn tsc --noEmit
```

Metro is configured (`metro.config.js`) to watch `../core-ts` and resolve its
`@noble/*` / `@scure/base` deps from this app's `node_modules`.

## Screens (mirrors `design/mockups.html`)

| File                                  | Screen                                                                 |
| ------------------------------------- | ---------------------------------------------------------------------- |
| `src/screens/ConnectScreen.tsx`       | Orb + tier pill + country row + connect button + live stats            |
| `src/screens/CountryPickerScreen.tsx` | Live fleet grouped by country, latency dots, node counts               |
| `src/screens/UpgradeScreen.tsx`       | **Manage-on-web** — tier + "Upgrade at cumulusvpn.com", no purchase UI |

Design tokens (cyan `#34E4DA` connect, amber `#F5B23D` premium, mono for data)
live in `src/theme/tokens.ts`. Navigation is a 3-state switch in `App.tsx` — no
react-navigation dependency for a three-screen app.

## Shared-core wiring

`src/state/useVpn.ts` is the whole brain: `generateKeypair` → `discoverGateways`
→ `enroll` → `buildWgConfig` → native tunnel → poll `status` for tier.
`src/lib/gateways.ts` shapes core's flat `GatewayInfo[]` into country rows;
`src/lib/directory.ts` bundles the signed `directory.json` snapshot + pinned
directory pubkey and verifies it with core `directoryVerify`.

## Native tunnel layer (scaffolded, real signatures, `// POC:` seams)

The JS bridge is `src/native/CumulusTunnel.ts`. Native stubs:

- **iOS** — `ios/CumulusTunnelExtension/PacketTunnelProvider.swift`
  (`NEPacketTunnelProvider` + WireGuardKit), `ios/CumulusTunnel/CumulusTunnelModule.swift`
  - `.m` bridge (`NETunnelProviderManager` control).
- **Android** — `android/.../CumulusTunnelModule.kt`,
  `CumulusVpnService.kt` (`VpnService` + `com.wireguard.android:tunnel`),
  `CumulusTunnelPackage.kt`.

## Store compliance (docs/05)

- Upgrade is **manage-on-web**: no in-app purchase UI, and **no tappable
  external link on iOS** — the URL is inert selectable text. Chain-based
  entitlement keyed to the WG pubkey unlocks the phone ~1 min after payment.
- iOS: org Apple Developer account + Network Extension entitlement; WireGuardKit
  uses NEVPNManager APIs (Apple 5.4). Note wireguard-apple's Go cross-compile in
  CI.
- Android: Play Console VpnService declaration form required.

## Native-build gaps (not run here)

Typecheck runs; native builds (`xcodebuild` / `gradle`) do **not** — those need
Xcode + org signing / Android SDK + NDK. Outstanding before a device build:

1. `react-native init`-level host projects (`ios/*.xcodeproj` + Podfile,
   `android/` Gradle wrapper + `MainApplication`) — this scaffold ships app
   sources + native modules, not the generated host shells.
2. Add WireGuardKit (SPM) and `com.wireguard.android:tunnel` (Gradle); remove
   the `#if canImport` / POC guards.
3. Link `react-native-get-random-values` (pod install / autolink) so core keygen
   has a CSPRNG under Hermes.
4. Secure storage: swap `src/state/storage.ts` for Keychain / Keystore +
   AsyncStorage; disk-cache tier of discovery.
5. Optional gradient (`react-native-linear-gradient`) and vector icons
   (`react-native-svg`) for pixel-parity with the mockup.
