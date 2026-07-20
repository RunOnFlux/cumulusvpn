/**
 * Loads the remote feature flags once at mount. Starts from DEFAULT_FLAGS (all
 * off — the safe state), then applies whatever the fetch returns. A failed fetch
 * leaves the safe defaults in place.
 */
import { useEffect, useState } from 'react';
import { DEFAULT_FLAGS, fetchFlags, type Flags } from '../lib/flags';

export function useFlags(): Flags {
  const [flags, setFlags] = useState<Flags>(DEFAULT_FLAGS);
  useEffect(() => {
    const ctrl = new AbortController();
    fetchFlags(ctrl.signal)
      .then(setFlags)
      .catch(() => undefined);
    return () => ctrl.abort();
  }, []);
  return flags;
}
