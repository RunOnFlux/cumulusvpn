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
}

const now = (): number => Math.floor(Date.now() / 1000);

export class SubscriptionsRepo {
  constructor(private readonly db: Db) {}

  upsert(rail: Rail, externalId: string, paymentCode: string, plan: Plan): void {
    this.db
      .prepare(
        `INSERT INTO subscriptions (rail, external_id, payment_code, plan, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', ?, ?)
         ON CONFLICT (rail, external_id) DO UPDATE SET
           payment_code = excluded.payment_code, plan = excluded.plan,
           status = 'active', updated_at = excluded.updated_at`,
      )
      .run(rail, externalId, paymentCode, plan, now(), now());
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
