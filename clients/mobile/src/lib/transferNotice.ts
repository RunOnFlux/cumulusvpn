/**
 * When to show the one-time "save your recovery key" prompt (flag
 * `transferNotice`, lib/flags.ts).
 *
 * Why it exists: moving the app to another App Store account (an App Store
 * transfer) changes the Apple team, and builds from the new team can't read the
 * Keychain copy kept in the old team's access group. The App Group copy
 * (native/CumulusIdentity) is meant to cover that; the recovery key is the
 * guaranteed fallback. Only devices with Premium have something to lose, so only
 * they are asked, once.
 */
import type { Tier } from '@cumulusvpn/core';

export interface TransferNoticeInput {
  /** The remote `transferNotice` flag for this platform. */
  readonly enabled: boolean;
  readonly tier: Tier;
  /** RFC3339 time premium is paid through, or null when unknown. */
  readonly paidUntil: string | null;
  /** Already shown and dismissed or acted on; null while still loading. */
  readonly seen: boolean | null;
  /** Unix ms. */
  readonly now: number;
}

/** True when the prompt should show now. */
export function shouldShowTransferNotice(i: TransferNoticeInput): boolean {
  if (!i.enabled || i.seen !== false || i.tier !== 'premium') {
    return false;
  }
  if (i.paidUntil === null) {
    return true;
  }
  const until = Date.parse(i.paidUntil);
  return Number.isNaN(until) || until > i.now;
}
