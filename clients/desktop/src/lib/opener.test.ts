import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isTauri } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { openExternal } from './opener';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));

const URL_ = 'https://vpn.cumulusvpn.com/#/upgrade?code=2RkUfDC55GMndKreXqK7Jruu8Snx';
let windowOpen: ReturnType<typeof vi.fn>;

beforeEach(() => {
  windowOpen = vi.fn();
  vi.stubGlobal('open', windowOpen);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('openExternal', () => {
  // The bug this fixes: in a Tauri webview window.open goes nowhere, so the
  // upgrade button did nothing and the desktop code never reached the web page.
  it('opens the system browser through the opener plugin inside Tauri', async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(openUrl).mockResolvedValue(undefined);
    await openExternal(URL_);
    expect(openUrl).toHaveBeenCalledWith(URL_);
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it('falls back to window.open when the plugin call fails', async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(openUrl).mockRejectedValue(new Error('not allowed'));
    await openExternal(URL_);
    expect(windowOpen).toHaveBeenCalledWith(URL_, '_blank', 'noopener');
  });

  it('uses window.open outside Tauri', async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    await openExternal(URL_);
    expect(openUrl).not.toHaveBeenCalled();
    expect(windowOpen).toHaveBeenCalledWith(URL_, '_blank', 'noopener');
  });
});
