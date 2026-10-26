/**
 * What the setup banner says for each tunnel-engine state, per OS.
 *
 * The app holds no privileges of its own: the tunnel belongs to the
 * `cumulusvpn-helper` daemon (a LaunchDaemon on macOS, a systemd service on
 * Linux, a Windows service). Until that daemon is there and serves this app,
 * Connect cannot work, so the banner says exactly what is missing and how to
 * fix it rather than letting Connect fail with a transport error. Never a
 * silent failure.
 *
 * Pure (the OS comes from the caller), so every message is unit-tested.
 */
import type { HelperRegistration } from './tauri.js';

export type DesktopOs = 'macos' | 'windows' | 'linux';

/** The desktop OS from a webview user agent (WKWebView, WebView2, WebKitGTK). */
export function desktopOs(userAgent: string): DesktopOs {
  if (/Windows/i.test(userAgent)) {
    return 'windows';
  }
  if (/Mac OS X|Macintosh/i.test(userAgent)) {
    return 'macos';
  }
  return 'linux';
}

export interface SetupBanner {
  /** What is missing and how to fix it. */
  readonly text: string;
  /** Offer the button that opens System Settings at the approval switch (macOS). */
  readonly openSettings: boolean;
  /** False for an informational note: Connect works, but the user should know. */
  readonly blocking: boolean;
}

/** The banner for `state`, or `null` when there is nothing to say. */
export function setupBanner(state: HelperRegistration, os: DesktopOs): SetupBanner | null {
  const block = (text: string, openSettings = false): SetupBanner => ({
    text,
    openSettings,
    blocking: true,
  });
  switch (state) {
    case 'enabled':
    case 'notNeeded':
      return null;
    case 'elevated':
      // The backend reports `elevated` on Linux only (`backend::choose`).
      return os === 'linux'
        ? {
            text: 'Running as root without CumulusVPN’s background service — the VPN stops when the app quits. Install the .deb or .rpm package to run it without root.',
            openSettings: false,
            blocking: false,
          }
        : null;
    case 'requiresApproval':
      return block('Allow the CumulusVPN network helper in System Settings to finish setup.', true);
    case 'notFound':
      return block('macOS could not verify CumulusVPN’s network helper — try reinstalling.');
    case 'notRegistered':
      return block('CumulusVPN needs to install its network helper before it can connect.', true);
    case 'serviceNotInstalled':
      return block(
        os === 'windows'
          ? 'CumulusVPN’s background service isn’t installed. Reinstall CumulusVPN, or run it as administrator.'
          : 'CumulusVPN’s background service isn’t installed. Install the .deb or .rpm package — or, for the AppImage, start CumulusVPN with sudo.',
      );
    case 'serviceNotRunning':
      return block(
        os === 'windows'
          ? 'CumulusVPN’s background service isn’t running. Start “CumulusVPN Helper” in Services, or reinstall CumulusVPN.'
          : 'CumulusVPN’s background service isn’t running. Start it with: sudo systemctl enable --now cumulusvpn-helper',
      );
    case 'serviceDenied':
      return block(
        os === 'windows'
          ? 'CumulusVPN’s background service only works with the installed app. Start CumulusVPN from the Start menu, or reinstall it.'
          : 'Almost there: log out and back in so your account can use CumulusVPN’s background service. Still here after that? Run: sudo usermod -aG cumulusvpn $USER',
      );
  }
}
