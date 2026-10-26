import { describe, expect, it } from 'vitest';
import { desktopOs, setupBanner } from './setup';
import type { HelperRegistration } from './tauri';

const ALL: HelperRegistration[] = [
  'enabled',
  'notNeeded',
  'elevated',
  'requiresApproval',
  'notRegistered',
  'notFound',
  'serviceNotInstalled',
  'serviceNotRunning',
  'serviceDenied',
];

describe('desktopOs', () => {
  it('reads the OS from each desktop webview', () => {
    expect(
      desktopOs(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0',
      ),
    ).toBe('windows');
    expect(
      desktopOs(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)',
      ),
    ).toBe('macos');
    expect(
      desktopOs('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko)'),
    ).toBe('linux');
  });
});

describe('setupBanner', () => {
  // Connect is enabled exactly when no blocking banner shows: a banner that
  // blocks while Connect works (or the reverse) would contradict itself.
  it('blocks exactly the states that are not ready', () => {
    for (const os of ['macos', 'linux', 'windows'] as const) {
      for (const state of ALL) {
        const banner = setupBanner(state, os);
        const ready = state === 'enabled' || state === 'notNeeded' || state === 'elevated';
        expect(banner?.blocking ?? false).toBe(!ready);
      }
    }
  });

  it('says nothing when the helper serves us', () => {
    expect(setupBanner('enabled', 'linux')).toBeNull();
    expect(setupBanner('notNeeded', 'macos')).toBeNull();
  });

  // Linux as root runs the tunnel itself, and it dies with the app: say so,
  // without blocking Connect.
  it('notes the Linux in-process mode without blocking', () => {
    const linux = setupBanner('elevated', 'linux');
    expect(linux?.blocking).toBe(false);
    expect(linux?.text).toMatch(/stops when the app quits/);
    expect(linux?.text).toMatch(/\.deb or \.rpm/);
    expect(setupBanner('elevated', 'windows')).toBeNull();
  });

  it('keeps the macOS approval flow and its Settings button', () => {
    expect(setupBanner('requiresApproval', 'macos')).toEqual({
      text: 'Allow the CumulusVPN network helper in System Settings to finish setup.',
      openSettings: true,
      blocking: true,
    });
    expect(setupBanner('notRegistered', 'macos')?.openSettings).toBe(true);
    // Reinstalling is the only fix for an unverifiable helper; no button.
    expect(setupBanner('notFound', 'macos')?.openSettings).toBe(false);
  });

  // Each Linux/Windows step names its own fix, and none offers the macOS
  // Settings button (it does nothing there).
  it('gives Linux the package, systemctl and group fixes', () => {
    expect(setupBanner('serviceNotInstalled', 'linux')?.text).toMatch(/\.deb or \.rpm.*sudo/);
    expect(setupBanner('serviceNotRunning', 'linux')?.text).toMatch(
      /sudo systemctl enable --now cumulusvpn-helper/,
    );
    const denied = setupBanner('serviceDenied', 'linux')?.text ?? '';
    expect(denied).toMatch(/log out and back in/);
    expect(denied).toMatch(/usermod -aG cumulusvpn/);
    for (const state of ['serviceNotInstalled', 'serviceNotRunning', 'serviceDenied'] as const) {
      expect(setupBanner(state, 'linux')?.openSettings).toBe(false);
      expect(setupBanner(state, 'windows')?.openSettings).toBe(false);
    }
  });

  it('gives Windows the reinstall, Services and installed-app fixes', () => {
    expect(setupBanner('serviceNotInstalled', 'windows')?.text).toMatch(/Reinstall CumulusVPN/);
    expect(setupBanner('serviceNotRunning', 'windows')?.text).toMatch(
      /CumulusVPN Helper.*Services/,
    );
    expect(setupBanner('serviceDenied', 'windows')?.text).toMatch(/installed app/);
    // Never Linux instructions on Windows.
    for (const state of ALL) {
      expect(setupBanner(state, 'windows')?.text ?? '').not.toMatch(/sudo|systemctl|\.deb/);
    }
  });
});
