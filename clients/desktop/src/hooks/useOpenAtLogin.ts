/**
 * Settings → Open at login: the OS login item (tauri-plugin-autostart). The
 * login launch passes `--autostart`, which starts the app hidden in the menu
 * bar / tray (src-tauri/src/lib.rs), so it is ready without a window popping
 * up. Pair with "Auto-connect on launch" for protection from boot.
 */
import { isTauri } from '@tauri-apps/api/core';
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
import { useCallback, useEffect, useState } from 'react';

export interface OpenAtLogin {
  /** null until read (or where unsupported). */
  readonly enabled: boolean | null;
  readonly set: (on: boolean) => void;
}

export function useOpenAtLogin(): OpenAtLogin {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    if (!isTauri()) {
      return;
    }
    void isEnabled()
      .then(setEnabled)
      .catch(() => setEnabled(null));
  }, []);
  const set = useCallback((on: boolean) => {
    setEnabled(on);
    void (on ? enable() : disable())
      .then(isEnabled)
      .then(setEnabled)
      .catch(() => setEnabled(!on));
  }, []);
  return { enabled, set };
}
