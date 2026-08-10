/**
 * Voucher store + the redemption transaction (docs/18).
 *
 * Codes are stored CANONICAL: uppercase, separators stripped, drawn from a
 * no-ambiguity alphabet (no 0/O/1/I/L). A `grant_days` redemption mints
 * treasury FLUX through the normal payments queue; the double-spend walls
 * are UNIQUE(voucher_id, payment_code) here plus the payments queue's
 * UNIQUE(rail, event_key = "<voucher_id>:<payment_code>") — money can only
 * ever move once per (voucher, device), enforced by the DB across restarts.
 */
import { randomBytes } from 'node:crypto';

import type { Db } from './db.js';
import type { PaymentsRepo } from './payments.js';
import { zatsForDays } from '../grants.js';

/** 31 chars, no 0/O/1/I/L — unambiguous to read aloud or retype. */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const GENERATED_LEN = 10;

export type VoucherType = 'grant_days' | 'stripe_discount';
export type VoucherStatus = 'active' | 'revoked';

export interface VoucherRow {
  readonly id: number;
  readonly code: string;
  readonly type: VoucherType;
  readonly value: number;
  readonly campaign: string;
  readonly max_redemptions: number;
  readonly redemption_count: number;
  readonly per_code_limit: number;
  readonly expires_at: number | null;
  readonly status: VoucherStatus;
  readonly stripe_coupon_id: string | null;
  readonly stripe_promo_id: string | null;
  readonly created_at: number;
}

export interface CampaignStats {
  readonly campaign: string;
  readonly vouchers: number;
  readonly active: number;
  readonly redemptions: number;
  readonly days_granted: number;
  readonly flux_spent: number;
  readonly last_redeemed_at: number | null;
}

/** Typed redemption failure — maps 1:1 onto the endpoint error taxonomy. */
export class RedeemError extends Error {
  constructor(readonly reason: 'invalid' | 'expired' | 'exhausted' | 'already_redeemed') {
    super(reason);
    this.name = 'RedeemError';
  }
}

const now = (): number => Math.floor(Date.now() / 1000);

/**
 * Canonicalize user/admin input: uppercase, strip separators and whitespace,
 * drop a display-dressing CVPN prefix. Returns null when what remains isn't
 * a plausible code (charset/length) — callers treat null as `invalid`.
 */
export function normalizeCode(input: string): string | null {
  let s = input.toUpperCase().replace(/[\s-]+/g, '');
  if (s.startsWith('CVPN') && s.length > GENERATED_LEN) {
    s = s.slice(4);
  }
  if (s.length < 6 || s.length > 20) {
    return null;
  }
  for (const ch of s) {
    if (!CODE_ALPHABET.includes(ch)) {
      return null;
    }
  }
  return s;
}

/** Display form of a canonical generated code: CVPN-XXXXX-XXXXX. */
export function displayCode(canonical: string): string {
  if (canonical.length === GENERATED_LEN) {
    return `CVPN-${canonical.slice(0, 5)}-${canonical.slice(5)}`;
  }
  return canonical;
}

/** One cryptographically random code char via rejection sampling (no modulo bias). */
function randomChar(): string {
  for (;;) {
    const b = randomBytes(1)[0]!;
    if (b < 248) {
      // 248 = 8 * 31 — the largest multiple of the alphabet size below 256.
      return CODE_ALPHABET[b % CODE_ALPHABET.length]!;
    }
  }
}

export function generateCode(): string {
  let out = '';
  for (let i = 0; i < GENERATED_LEN; i++) {
    out += randomChar();
  }
  return out;
}

export interface CreateVouchersInput {
  readonly type: VoucherType;
  readonly value: number;
  /** Generated batch size (XOR vanityCode). */
  readonly count?: number;
  /** Admin-supplied vanity code (XOR count). Normalized before storage. */
  readonly vanityCode?: string;
  readonly campaign?: string;
  readonly maxRedemptions?: number;
  readonly perCodeLimit?: number;
  readonly expiresAt?: number | null;
}

export class VouchersRepo {
  constructor(
    private readonly db: Db,
    private readonly payments: PaymentsRepo,
    private readonly priceZats: number,
  ) {}

  byCanonicalCode(code: string): VoucherRow | undefined {
    return this.db.prepare(`SELECT * FROM vouchers WHERE code = ?`).get(code) as
      VoucherRow | undefined;
  }

  byId(id: number): VoucherRow | undefined {
    return this.db.prepare(`SELECT * FROM vouchers WHERE id = ?`).get(id) as VoucherRow | undefined;
  }

  /** Insert a batch of vouchers; returns the created rows (with canonical codes). */
  createBatch(
    input: CreateVouchersInput,
    codes: readonly string[],
    stripeIds?: { couponId: string; promoIds: readonly string[] },
  ): VoucherRow[] {
    const ins = this.db.prepare(
      `INSERT INTO vouchers (code, type, value, campaign, max_redemptions, per_code_limit, expires_at, status, stripe_coupon_id, stripe_promo_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    );
    const rows: VoucherRow[] = [];
    this.db.transaction(() => {
      codes.forEach((code, i) => {
        const r = ins.run(
          code,
          input.type,
          input.value,
          input.campaign ?? '',
          input.maxRedemptions ?? 1,
          input.perCodeLimit ?? 1,
          input.expiresAt ?? null,
          stripeIds?.couponId ?? null,
          stripeIds?.promoIds[i] ?? null,
          now(),
        );
        rows.push(this.byId(Number(r.lastInsertRowid))!);
      });
    })();
    return rows;
  }

  list(filter: {
    campaign?: string;
    status?: VoucherStatus;
    limit: number;
    offset: number;
  }): VoucherRow[] {
    const where: string[] = [];
    const args: unknown[] = [];
    if (filter.campaign !== undefined) {
      where.push('campaign = ?');
      args.push(filter.campaign);
    }
    if (filter.status !== undefined) {
      where.push('status = ?');
      args.push(filter.status);
    }
    const sql = `SELECT * FROM vouchers ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`;
    return this.db.prepare(sql).all(...args, filter.limit, filter.offset) as VoucherRow[];
  }

  revoke(id: number): VoucherRow | undefined {
    this.db.prepare(`UPDATE vouchers SET status = 'revoked' WHERE id = ?`).run(id);
    return this.byId(id);
  }

  stats(campaign?: string): CampaignStats[] {
    const where = campaign !== undefined ? 'WHERE v.campaign = ?' : '';
    const args = campaign !== undefined ? [campaign] : [];
    return this.db
      .prepare(
        `SELECT v.campaign AS campaign,
                COUNT(DISTINCT v.id) AS vouchers,
                SUM(CASE WHEN v.status = 'active' THEN 1 ELSE 0 END) AS active,
                COUNT(r.id) AS redemptions,
                COALESCE(SUM(CASE WHEN v.type = 'grant_days' AND r.id IS NOT NULL THEN v.value ELSE 0 END), 0) AS days_granted,
                COALESCE(SUM(p.flux_zats), 0) / 1e8 AS flux_spent,
                MAX(r.redeemed_at) AS last_redeemed_at
         FROM vouchers v
         LEFT JOIN voucher_redemptions r ON r.voucher_id = v.id
         LEFT JOIN payments p ON p.id = r.payment_id
         ${where}
         GROUP BY v.campaign
         ORDER BY MAX(v.created_at) DESC`,
      )
      .all(...args) as CampaignStats[];
  }

  /** Redemptions a payment code already holds across a campaign. */
  private campaignRedemptions(campaign: string, paymentCode: string): number {
    return (
      this.db
        .prepare(
          `SELECT COUNT(*) AS c FROM voucher_redemptions r
           JOIN vouchers v ON v.id = r.voucher_id
           WHERE v.campaign = ? AND r.payment_code = ?`,
        )
        .get(campaign, paymentCode) as { c: number }
    ).c;
  }

  /**
   * Consume a grant voucher for a payment code and enqueue the chain grant.
   * Throws RedeemError; returns the payments queue row id. All-or-nothing:
   * the count increment, the redemption row, and the queue insert commit
   * together (better-sqlite3 is synchronous single-writer, so requests
   * cannot interleave — the transaction is crash-atomicity + backstop).
   */
  redeemGrant(voucher: VoucherRow, paymentCode: string): number {
    const tx = this.db.transaction((): number => {
      if (voucher.campaign !== '' && voucher.per_code_limit > 0) {
        if (this.campaignRedemptions(voucher.campaign, paymentCode) >= voucher.per_code_limit) {
          throw new RedeemError('already_redeemed');
        }
      }
      // Atomic check-and-increment: exhaustion, revocation and expiry are
      // all re-verified inside the guarded UPDATE.
      const upd = this.db
        .prepare(
          `UPDATE vouchers SET redemption_count = redemption_count + 1
            WHERE id = ? AND status = 'active'
              AND redemption_count < max_redemptions
              AND (expires_at IS NULL OR expires_at > ?)`,
        )
        .run(voucher.id, now());
      if (upd.changes === 0) {
        throw new RedeemError('exhausted');
      }
      let redemptionId: number;
      try {
        const red = this.db
          .prepare(
            `INSERT INTO voucher_redemptions (voucher_id, payment_code, redeemed_at) VALUES (?, ?, ?)`,
          )
          .run(voucher.id, paymentCode, now());
        redemptionId = Number(red.lastInsertRowid);
      } catch {
        // UNIQUE(voucher_id, payment_code) — this device already used it.
        throw new RedeemError('already_redeemed');
      }
      const paymentId = this.payments.insertIdempotent({
        rail: 'voucher',
        eventKey: `${voucher.id}:${paymentCode}`,
        externalRef: `voucher:${voucher.code}`,
        paymentCode,
        days: voucher.value,
        fluxZats: zatsForDays(this.priceZats, voucher.value),
      });
      if (paymentId !== null) {
        this.db
          .prepare(`UPDATE voucher_redemptions SET payment_id = ? WHERE id = ?`)
          .run(paymentId, redemptionId);
      }
      return redemptionId;
    });
    return tx();
  }

  /**
   * Record a STRIPE DISCOUNT redemption observed on a paid invoice (webhook
   * side — the voucher is not consumed at checkout). Idempotent per
   * (voucher, payment_code); increments the count only on first sight.
   */
  recordDiscountRedemption(
    voucherId: number,
    paymentCode: string,
    paymentId: number | null,
  ): boolean {
    const tx = this.db.transaction((): boolean => {
      const r = this.db
        .prepare(
          `INSERT OR IGNORE INTO voucher_redemptions (voucher_id, payment_code, payment_id, redeemed_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run(voucherId, paymentCode, paymentId, now());
      if (r.changes === 1) {
        this.db
          .prepare(`UPDATE vouchers SET redemption_count = redemption_count + 1 WHERE id = ?`)
          .run(voucherId);
        return true;
      }
      return false;
    });
    return tx();
  }

  byStripePromoId(promoId: string): VoucherRow | undefined {
    return this.db.prepare(`SELECT * FROM vouchers WHERE stripe_promo_id = ?`).get(promoId) as
      VoucherRow | undefined;
  }

  byStripeCouponId(couponId: string): VoucherRow | undefined {
    return this.db
      .prepare(`SELECT * FROM vouchers WHERE stripe_coupon_id = ? LIMIT 1`)
      .get(couponId) as VoucherRow | undefined;
  }
}
