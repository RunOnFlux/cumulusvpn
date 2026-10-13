/**
 * The one-time "save your recovery key" prompt (lib/transferNotice.ts): whether
 * to show it now, and marking it seen. Seen is persisted, so it never returns
 * once dismissed or acted on, even if the flag stays on.
 */
import { useCallback, useEffect, useState } from 'react';
import type { Tier } from '@cumulusvpn/core';
import { shouldShowTransferNotice } from '../lib/transferNotice';
import { SCREENSHOT_MODE } from '../lib/screenshot';
import { loadTransferNoticeSeen, saveTransferNoticeSeen } from './storage';

export interface TransferNotice {
  readonly visible: boolean;
  /** Hide it for good. */
  dismiss(): void;
}

export function useTransferNotice(
  enabled: boolean,
  tier: Tier,
  paidUntil: string | null,
): TransferNotice {
  const [seen, setSeen] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    loadTransferNoticeSeen()
      .then((v) => {
        if (alive) {
          setSeen(v);
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  const dismiss = useCallback(() => {
    setSeen(true);
    saveTransferNoticeSeen().catch(() => undefined);
  }, []);
  // Store-capture builds never show it (a flag left on would land in a screenshot).
  const visible =
    !SCREENSHOT_MODE &&
    shouldShowTransferNotice({ enabled, tier, paidUntil, seen, now: Date.now() });
  return { visible, dismiss };
}
