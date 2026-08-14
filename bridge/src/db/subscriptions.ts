/** Typed repository over `subscriptions` + `apple_token_map`. */
import type { Db } from './db.js';
import type { Rail } from './payments.js';

export type Plan = 'monthly' | 'annual';
export type SubscriptionStatus = 'active' | 'canceled' | 'refunded' | 'on_hold';

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
