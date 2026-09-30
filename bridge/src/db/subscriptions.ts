/** Typed repository over `subscriptions` + `apple_token_map` + `subscription_transfers`. */
import type { Db } from './db.js';
import type { Rail } from './payments.js';

export type Plan = 'monthly' | 'annual';
export type SubscriptionStatus = 'active' | 'canceled' | 'refunded' | 'on_hold';
/** Who moved a subscription: the buyer (claim / Stripe transfer) or support. */
export type TransferActor = 'user' | 'admin';

export interface SubscriptionRow {
  readonly rail: Rail;
  readonly external_id: string;
  readonly payment_code: string;
  readonly plan: Plan;
  readonly status: SubscriptionStatus;
  readonly created_at: number;
  readonly updated_at: number;
  /** Stripe Customer id (stripe rail only; null until first seen). */
  readonly stripe_customer_id: string | null;
  /** Unix seconds of the last move to another code; null if never moved. */
  readonly transferred_at: number | null;
  /** Apple only: expiresDate (ms) of the last verified transaction. */
  readonly apple_expires_ms: number | null;
  /** Apple only: 1 when that transaction verified against the sandbox. */
  readonly apple_sandbox: number | null;
}

export interface TransferRow {
  readonly id: number;
  readonly rail: Rail;
  readonly external_id: string;
  readonly from_code: string | null;
  readonly to_code: string;
  readonly actor: TransferActor;
  readonly days: number;
  readonly created_at: number;
}

const now = (): number => Math.floor(Date.now() / 1000);

export class SubscriptionsRepo {
  constructor(private readonly db: Db) {}

  /**
   * Record (or refresh) a subscription. `customerId` is Stripe-only and
   * COALESCEd on update: a renewal that arrives without one must never wipe
   * the id we already learned at checkout.
   */
  upsert(
    rail: Rail,
    externalId: string,
    paymentCode: string,
    plan: Plan,
    customerId: string | null = null,
  ): void {
    this.db
      .prepare(
        `INSERT INTO subscriptions (rail, external_id, payment_code, plan, status, created_at, updated_at, stripe_customer_id)
         VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
         ON CONFLICT (rail, external_id) DO UPDATE SET
           payment_code = excluded.payment_code, plan = excluded.plan,
           status = 'active', updated_at = excluded.updated_at,
           stripe_customer_id = COALESCE(excluded.stripe_customer_id, subscriptions.stripe_customer_id)`,
      )
      .run(rail, externalId, paymentCode, plan, now(), now(), customerId);
  }

  /**
   * Every subscription bound to a payment code, newest first — the support
   * lookup behind the dashboard's "who is this code?" panel.
   */
  listForCode(paymentCode: string): readonly SubscriptionRow[] {
    return this.db
      .prepare(`SELECT * FROM subscriptions WHERE payment_code = ? ORDER BY updated_at DESC`)
      .all(paymentCode) as SubscriptionRow[];
  }

  /**
   * Move a subscription to another payment code and stamp the move: the
   * binding every later renewal resolves through, the 30-day transfer clock,
   * and an audit row. Status is left alone on an existing row — support may
   * rebind a canceled subscription without reviving it.
   *
   * @returns The code it was bound to before, if any.
   */
  rebind(
    rail: Rail,
    externalId: string,
    paymentCode: string,
    plan: Plan,
    actor: TransferActor,
    days: number,
  ): string | null {
    return this.db.transaction(() => {
      const previous = this.get(rail, externalId)?.payment_code ?? null;
      this.db
        .prepare(
          `INSERT INTO subscriptions (rail, external_id, payment_code, plan, status, created_at, updated_at, transferred_at)
           VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
           ON CONFLICT (rail, external_id) DO UPDATE SET
             payment_code = excluded.payment_code, plan = excluded.plan,
             updated_at = excluded.updated_at, transferred_at = excluded.transferred_at`,
        )
        .run(rail, externalId, paymentCode, plan, now(), now(), now());
      this.db
        .prepare(
          `INSERT INTO subscription_transfers (rail, external_id, from_code, to_code, actor, days, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(rail, externalId, previous, paymentCode, actor, days, now());
      return previous;
    })();
  }

  /** Every move into or out of a code, newest first (support lookup). */
  transfersForCode(paymentCode: string, limit = 25): readonly TransferRow[] {
    return this.db
      .prepare(
        `SELECT * FROM subscription_transfers WHERE from_code = ? OR to_code = ?
         ORDER BY created_at DESC, id DESC LIMIT ?`,
      )
      .all(paymentCode, paymentCode, limit) as TransferRow[];
  }

  /**
   * Remember the period a verified Apple transaction runs to. Apple renewals
   * reach us only as notifications, and there is no API key to ask Apple
   * later, so this is what a support rebind sizes "the rest of the period"
   * from. Only ever moves forward: a client re-verifying an OLD transaction
   * must not rewind it to a period that already ended.
   */
  noteAppleExpiry(originalTransactionId: string, expiresMs: number, sandbox: boolean): void {
    this.db
      .prepare(
        `UPDATE subscriptions SET apple_expires_ms = ?, apple_sandbox = ?
         WHERE rail = 'apple' AND external_id = ?
           AND (apple_expires_ms IS NULL OR apple_expires_ms <= ?)`,
      )
      .run(expiresMs, sandbox ? 1 : 0, originalTransactionId, expiresMs);
  }

  get(rail: Rail, externalId: string): SubscriptionRow | undefined {
    return this.db
      .prepare(`SELECT * FROM subscriptions WHERE rail = ? AND external_id = ?`)
      .get(rail, externalId) as SubscriptionRow | undefined;
  }

  setStatus(rail: Rail, externalId: string, status: SubscriptionStatus): void {
    this.db
      .prepare(
        `UPDATE subscriptions SET status = ?, updated_at = ? WHERE rail = ? AND external_id = ?`,
      )
      .run(status, now(), rail, externalId);
  }

  mapAppleToken(appAccountToken: string, paymentCode: string): void {
    this.db
      .prepare(
        `INSERT INTO apple_token_map (app_account_token, payment_code) VALUES (?, ?)
         ON CONFLICT (app_account_token) DO UPDATE SET payment_code = excluded.payment_code`,
      )
      .run(appAccountToken.toLowerCase(), paymentCode);
  }

  codeForAppleToken(appAccountToken: string): string | undefined {
    const row = this.db
      .prepare(`SELECT payment_code FROM apple_token_map WHERE app_account_token = ?`)
      .get(appAccountToken.toLowerCase()) as { payment_code: string } | undefined;
    return row?.payment_code;
  }
}
