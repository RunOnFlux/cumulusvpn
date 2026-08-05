/**
 * Build-time constants injected by Babel (see babel.config.js). Kept as an
 * ambient declaration — do NOT add imports/exports here or the file becomes a
 * module and these stop being global.
 */

/** App version, inlined from package.json at build time. */
declare const __APP_VERSION__: string;

/**
 * Screenshot mode — replaces live latency and the tunnel with fixed demo data
 * so the App Store / Play captures can be taken on a Simulator (where iOS
 * packet-tunnel extensions cannot run) and from any network.
 *
 * Inlined as a literal `false` unless the bundle was built with
 * `CVPN_SCREENSHOT=1`, so every `if (__SCREENSHOT_MODE__)` branch is dead code
 * the minifier strips. A store build therefore cannot contain the demo data or
 * reach the demo path — this is a build-time gate, not a runtime flag, for the
 * same reason PURCHASE_UI_PLATFORMS is (see src/lib/flags.ts).
 */
declare const __SCREENSHOT_MODE__: boolean;
