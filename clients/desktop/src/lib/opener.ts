/**
 * Open a web page in the user's default browser.
 *
 * A Tauri webview does not hand `window.open` to the system browser, so the
 * upgrade button used to do nothing in a shipped build. Inside Tauri this goes
 * through `@tauri-apps/plugin-opener` (granted by `opener:default` in
 * `src-tauri/capabilities/default.json`, which allows http/https URLs). Outside
 * Tauri (`vite dev`, tests), or if the plugin call fails, it falls back to
 * `window.open`.
 */
import { isTauri } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';

export async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    try {
      await openUrl(url);
      return;
    } catch {
      // Fall through: a page that opens somewhere beats a dead button.
    }
  }
  try {
    window.open(url, '_blank', 'noopener');
  } catch {
    /* no-op in headless contexts */
  }
}
