import { useCallback, useEffect, useState } from 'react';
import { THEME_STORAGE_KEY } from '../config';

export type ThemeMode = 'system' | 'light' | 'dark';

function readStored(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function apply(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', mode);
  }
}

/**
 * Theme control that mirrors the mockup: default follows the OS preference; an
 * explicit choice is stamped on `<html data-theme>` and persisted. Cycles
 * system → dark → light → system.
 */
export function useTheme(): readonly [ThemeMode, () => void] {
  const [mode, setMode] = useState<ThemeMode>(readStored);

  useEffect(() => {
    apply(mode);
    try {
      if (mode === 'system') {
        localStorage.removeItem(THEME_STORAGE_KEY);
      } else {
        localStorage.setItem(THEME_STORAGE_KEY, mode);
      }
    } catch {
      // Ignore storage failures (private mode).
    }
  }, [mode]);

  const toggle = useCallback(() => {
    setMode((m) => (m === 'system' ? 'dark' : m === 'dark' ? 'light' : 'system'));
  }, []);

  return [mode, toggle] as const;
}
