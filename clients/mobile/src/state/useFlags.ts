/**
 * Loads the remote feature flags at mount and again whenever the app returns to
 * the foreground, so a remote flip (e.g. turning inAppUpgrade off for App Store
 * review) reaches a running app on resume instead of only on a cold start.
 * Starts from DEFAULT_FLAGS (all off — the safe state); a failed fetch leaves the
 * current flags in place.
 */
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { DEFAULT_FLAGS, fetchFlags, type Flags } from '../lib/flags';

export function useFlags(): Flags {
  const [flags, setFlags] = useState<Flags>(DEFAULT_FLAGS);
  useEffect(() => {
    let alive = true;
    let ctrl = new AbortController();
    const load = () => {
      ctrl.abort();
      ctrl = new AbortController();
      fetchFlags(ctrl.signal)
        .then((f) => {
          if (alive) {
            setFlags(f);
          }
        })
        .catch(() => undefined);
    };
    load();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        load();
      }
    });
    return () => {
      alive = false;
      ctrl.abort();
      sub.remove();
    };
  }, []);
  return flags;
}
