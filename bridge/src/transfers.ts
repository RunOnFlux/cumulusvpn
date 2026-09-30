/**
 * Moving a store subscription to another payment code — "subscriptions follow
 * the person" (docs/18-payments-bridge.md, "Claims and transfers").
 *
 * A device's identity is its WireGuard key, so a reinstall is a NEW code, and
 * a Play promo / Apple offer code redeemed outside the app carries no code at
 * all. Claims let the store account that holds a purchase bind it to the code
 * in front of it; a transfer moves an already-bound subscription.
 *
 * Chain grants cannot be clawed back, so every move hands the new code the
 * rest of the current period while the old code keeps what it already has.
 * Two walls bound that overlap: one transfer per subscription per 30 days,
 * and ONE transfer grant per billing period, enforced by the payments queue's
 * UNIQUE(rail, event_key) on {@link transferEventKey} — which holds even if the
 * rate limit were misconfigured, and even across support rebinds.
 */
import { PLAN_DAYS } from './config.js';
import type { Plan } from './db/subscriptions.js';
import type { GrantResult } from './grants.js';

/** Minimum spacing between two moves of the same subscription. */
export const TRANSFER_INTERVAL_S = 30 * 86_400;

const DAY_MS = 86_400_000;

/**
 * Days left in a billing period: ceil to whole days, at least 1, never more
 * than the plan itself. 0 once the period has ended — there is nothing left
 * to hand over, and the next renewal credits the new binding anyway.
 */
export function remainingDays(periodEndMs: number, nowMs: number, plan: Plan): number {
  if (!Number.isFinite(periodEndMs) || periodEndMs <= nowMs) {
    return 0;
  }
  return Math.min(PLAN_DAYS[plan], Math.max(1, Math.ceil((periodEndMs - nowMs) / DAY_MS)));
}

/**
 * Idempotency key of a transfer grant: one per subscription per billing
 * period. `subscriptionKey` is the rail's stable id (purchaseToken,
 * originalTransactionId, Stripe subscription id) and the period end names the
 * period, so moving the same period twice — A→B then B→A, or a user transfer
 * and a support rebind — collapses onto one chain payment.
 */
export function transferEventKey(subscriptionKey: string, periodEndMs: number): string {
  return `transfer:${subscriptionKey}:${periodEndMs}`;
}

/**
 * When a subscription last moved at `transferredAt` (unix seconds) may move
 * again: null when it may now, else the unix-seconds moment it can.
 */
export function transferAvailableAt(transferredAt: number | null, nowS: number): number | null {
  if (transferredAt === null) {
    return null;
  }
  const at = transferredAt + TRANSFER_INTERVAL_S;
  return at > nowS ? at : null;
}

/**
 * Outcome of a claim or a transfer. Refusals the client is expected to act
 * on carry these reasons: `owned_by_other_device` (ask the user, then retry
 * with transfer) and `transfer_too_soon` (with `availableAt`). Anything else
 * that is not accepted is a verification failure, reported like verify's.
 */
export interface ClaimOutcome {
  readonly accepted: boolean;
  readonly reason: string;
  readonly days?: number;
  readonly test?: boolean;
  readonly transferred?: boolean;
  /** Unix seconds when a refused transfer becomes possible. */
  readonly availableAt?: number;
}

/** Outcome of a support rebind (`POST /internal/subscriptions/rebind`). */
export interface RebindOutcome {
  readonly ok: boolean;
  /** 'rebound', or why not: not_found / not_active / no_current_period / a verify reason. */
  readonly reason: string;
  readonly previousCode?: string | null;
  readonly days?: number;
  /** The rest-of-period grant: queued, duplicate (that period was already handed over), or none. */
  readonly grant?: GrantResult | 'none';
  readonly test?: boolean;
}

/** Human line for a `transfer_too_soon` refusal; ends in the ISO-8601 date. */
export function tooSoonMessage(availableAt: number): string {
  return `this subscription moved in the last 30 days; it can move again after ${new Date(
    availableAt * 1000,
  ).toISOString()}`;
}
