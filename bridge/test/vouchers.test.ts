import { describe, expect, it } from 'vitest';
import { base58 } from '@scure/base';

import { openDb } from '../src/db/db.js';
import { PaymentsRepo } from '../src/db/payments.js';
import {
  CODE_ALPHABET,
  displayCode,
  generateCode,
  normalizeCode,
  RedeemError,
  VouchersRepo,
} from '../src/db/vouchers.js';
import { zatsForDays } from '../src/grants.js';
import { InvalidAttemptBreaker } from '../src/breaker.js';

const PRICE_ZATS = 2_000_000_000; // 20 FLUX
const DEVICE_A = base58.encode(new Uint8Array(20).fill(1));
const DEVICE_B = base58.encode(new Uint8Array(20).fill(2));

function fresh(): { vouchers: VouchersRepo; payments: PaymentsRepo } {
  const db = openDb(':memory:');
  const payments = new PaymentsRepo(db);
  return { vouchers: new VouchersRepo(db, payments, PRICE_ZATS), payments };
}

function makeVoucher(
  vouchers: VouchersRepo,
  over: Partial<{
    value: number;
    max: number;
    perCode: number;
    expires: number | null;
    campaign: string;
  }> = {},
) {
  const [row] = vouchers.createBatch(
    {
      type: 'grant_days',
      value: over.value ?? 7,
      campaign: over.campaign ?? '',
      maxRedemptions: over.max ?? 1,
      perCodeLimit: over.perCode ?? 1,
      expiresAt: over.expires ?? null,
    },
    [generateCode()],
  );
  return row!;
}

describe('code format', () => {
  it('generates 10-char codes from the unambiguous alphabet', () => {
    for (let i = 0; i < 50; i++) {
      const c = generateCode();
      expect(c).toHaveLength(10);
      for (const ch of c) {
        expect(CODE_ALPHABET).toContain(ch);
      }
    }
  });

  it('normalizes display dressing back to canonical', () => {
    const canonical = generateCode();
    expect(normalizeCode(displayCode(canonical))).toBe(canonical);
    expect(
      normalizeCode(` cvpn-${canonical.slice(0, 5)}-${canonical.slice(5).toLowerCase()} `),
    ).toBe(canonical);
  });

  it('rejects ambiguous or malformed input', () => {
    expect(normalizeCode('LAUNCH2O26')).toBeNull(); // O and L not in alphabet
    expect(normalizeCode('abc')).toBeNull(); // too short
    expect(normalizeCode('X'.repeat(25))).toBeNull(); // too long
    expect(normalizeCode('CVPN-!!!!!-!!!!!')).toBeNull();
  });
});

describe('grant redemption', () => {
  it('enqueues a ceil-sized chain payment through the normal queue', () => {
    const { vouchers, payments } = fresh();
    const v = makeVoucher(vouchers, { value: 7 });
    vouchers.redeemGrant(v, DEVICE_A);
    const row = payments.byCode(DEVICE_A)[0]!;
    expect(row.rail).toBe('voucher');
    expect(row.days).toBe(7);
    expect(row.flux_zats).toBe(466_666_667); // ceil(2e9*7/30) — gateway grants exactly 7
    expect(row.event_key).toBe(`${v.id}:${DEVICE_A}`);
    expect(row.status).toBe('pending');
  });

  it('a device can never redeem the same voucher twice', () => {
    const { vouchers } = fresh();
    const v = makeVoucher(vouchers, { max: 100 });
    vouchers.redeemGrant(v, DEVICE_A);
    expect(() => vouchers.redeemGrant(vouchers.byId(v.id)!, DEVICE_A)).toThrow(RedeemError);
    try {
      vouchers.redeemGrant(vouchers.byId(v.id)!, DEVICE_A);
    } catch (e) {
      expect((e as RedeemError).reason).toBe('already_redeemed');
    }
  });

  it('max_redemptions exhausts atomically', () => {
    const { vouchers } = fresh();
    const v = makeVoucher(vouchers, { max: 2 });
    vouchers.redeemGrant(vouchers.byId(v.id)!, DEVICE_A);
    vouchers.redeemGrant(vouchers.byId(v.id)!, DEVICE_B);
    const third = base58.encode(new Uint8Array(20).fill(3));
    expect(() => vouchers.redeemGrant(vouchers.byId(v.id)!, third)).toThrow(RedeemError);
    expect(vouchers.byId(v.id)!.redemption_count).toBe(2);
  });

  it('an exhausted throw rolls the count increment back', () => {
    const { vouchers } = fresh();
    const v = makeVoucher(vouchers, { max: 1 });
    vouchers.redeemGrant(vouchers.byId(v.id)!, DEVICE_A);
    try {
      vouchers.redeemGrant(vouchers.byId(v.id)!, DEVICE_B);
    } catch {
      // expected
    }
    expect(vouchers.byId(v.id)!.redemption_count).toBe(1);
  });

  it('per-campaign limit blocks a second code from the same campaign', () => {
    const { vouchers } = fresh();
    const a = makeVoucher(vouchers, { campaign: 'launch', perCode: 1 });
    const b = makeVoucher(vouchers, { campaign: 'launch', perCode: 1 });
    vouchers.redeemGrant(a, DEVICE_A);
    expect(() => vouchers.redeemGrant(vouchers.byId(b.id)!, DEVICE_A)).toThrow(RedeemError);
    // A different device is fine.
    vouchers.redeemGrant(vouchers.byId(b.id)!, DEVICE_B);
  });

  it('revoke stops future redemptions (guarded UPDATE)', () => {
    const { vouchers } = fresh();
    const v = makeVoucher(vouchers, { max: 10 });
    vouchers.revoke(v.id);
    expect(() => vouchers.redeemGrant(vouchers.byId(v.id)!, DEVICE_A)).toThrow(RedeemError);
  });

  it('expiry is enforced inside the transaction too', () => {
    const { vouchers } = fresh();
    const v = makeVoucher(vouchers, { expires: Math.floor(Date.now() / 1000) - 10 });
    expect(() => vouchers.redeemGrant(v, DEVICE_A)).toThrow(RedeemError);
  });
});

describe('discount redemption tracking', () => {
  it('records once per (voucher, code) and increments the count', () => {
    const { vouchers } = fresh();
    const [v] = vouchers.createBatch(
      { type: 'stripe_discount', value: 50, maxRedemptions: 100 },
      [generateCode()],
      { couponId: 'coup_1', promoIds: ['promo_1'] },
    );
    expect(vouchers.byStripePromoId('promo_1')?.id).toBe(v!.id);
    expect(vouchers.recordDiscountRedemption(v!.id, DEVICE_A, null)).toBe(true);
    expect(vouchers.recordDiscountRedemption(v!.id, DEVICE_A, null)).toBe(false); // webhook retry
    expect(vouchers.byId(v!.id)!.redemption_count).toBe(1);
  });
});

describe('stats', () => {
  it('aggregates per campaign with treasury spend', () => {
    const { vouchers, payments } = fresh();
    const v = makeVoucher(vouchers, { campaign: 'promo7', value: 7, max: 10, perCode: 0 });
    vouchers.redeemGrant(v, DEVICE_A);
    vouchers.redeemGrant(vouchers.byId(v.id)!, DEVICE_B);
    const stats = vouchers.stats('promo7');
    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({
      campaign: 'promo7',
      vouchers: 1,
      redemptions: 2,
      days_granted: 14,
    });
    expect(stats[0]!.flux_spent).toBeCloseTo((2 * zatsForDays(PRICE_ZATS, 7)) / 1e8, 6);
    expect(payments.queueStats().pending).toBe(2);
  });
});

describe('breaker', () => {
  it('trips after the threshold and closes for the cooldown', () => {
    let tripped = 0;
    const b = new InvalidAttemptBreaker(3, 60_000, 120_000, () => {
      tripped++;
    });
    const t0 = 1_000_000;
    for (let i = 0; i < 4; i++) {
      b.recordInvalid(t0 + i);
    }
    expect(tripped).toBe(1);
    expect(b.isOpen(t0 + 10)).toBe(true);
    expect(b.isOpen(t0 + 120_010)).toBe(false);
  });

  it('forgets attempts outside the window', () => {
    let tripped = 0;
    const b = new InvalidAttemptBreaker(3, 1_000, 10_000, () => {
      tripped++;
    });
    for (let i = 0; i < 3; i++) {
      b.recordInvalid(i * 2_000); // spaced beyond the window
    }
    b.recordInvalid(10_000);
    expect(tripped).toBe(0);
  });
});
