import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { openDb } from '../src/db/db.js';
import { MIGRATIONS } from '../src/db/migrations.js';
import { PaymentsRepo } from '../src/db/payments.js';
import { SubscriptionsRepo } from '../src/db/subscriptions.js';

const CODE = 'BS9J1c9RcXVGpNNUM3nlyLVm1DTx'; // syntactically fine; validity checked in grants tests

function fresh(): { payments: PaymentsRepo; subs: SubscriptionsRepo } {
  const db = openDb(':memory:');
  return { payments: new PaymentsRepo(db), subs: new SubscriptionsRepo(db) };
}

describe('payments idempotency', () => {
  it('the same (rail, event_key) can only ever insert once', () => {
    const { payments } = fresh();
    const p = {
      rail: 'stripe' as const,
      eventKey: 'in_123',
      externalRef: 'sub_1',
      paymentCode: CODE,
      days: 30,
      fluxZats: 20e8,
    };
    expect(payments.insertIdempotent(p)).not.toBeNull();
    expect(payments.insertIdempotent(p)).toBeNull();
    expect(payments.insertIdempotent({ ...p, days: 360 })).toBeNull(); // even with different payload
    // Distinct renewals (new invoice ids) do insert.
    expect(payments.insertIdempotent({ ...p, eventKey: 'in_124' })).not.toBeNull();
    // Same key on a different rail is a different event.
    expect(payments.insertIdempotent({ ...p, rail: 'apple' })).not.toBeNull();
  });

  it('walks the pending -> broadcast -> confirmed lifecycle with outpoint bookkeeping', () => {
    const { payments } = fresh();
    payments.insertIdempotent({
      rail: 'google',
      eventKey: 'GPA.1-0',
      externalRef: 'tok',
      paymentCode: CODE,
      days: 30,
      fluxZats: 20e8,
    });
    const row = payments.nextPending();
    expect(row).toBeDefined();

    payments.markBroadcast(row!.id, 'txid-abc', 'deadbeef00', 1000, [{ txid: 'prev', vout: 0 }]);
    expect(payments.nextPending()).toBeUndefined();
    expect(payments.spentOutpoints().has('prev:0')).toBe(true);
    const held = payments.allBroadcast();
    expect(held).toHaveLength(1);
    // Write-ahead invariant: the exact bytes are durable for re-broadcast.
    expect(held[0]!.raw_hex).toBe('deadbeef00');

    payments.markConfirmed(row!.id);
    expect(payments.allBroadcast()).toHaveLength(0);
    expect(payments.byCode(CODE)[0]!.status).toBe('confirmed');
    // Confirmed inputs are provably consumed on-chain — ledger rows pruned.
    expect(payments.spentOutpoints().has('prev:0')).toBe(false);
  });

  it('resetExpired releases held outpoints and requeues', () => {
    const { payments } = fresh();
    payments.insertIdempotent({
      rail: 'apple',
      eventKey: 't1',
      externalRef: 'o1',
      paymentCode: CODE,
      days: 360,
      fluxZats: 240e8,
    });
    const row = payments.nextPending()!;
    payments.markBroadcast(row.id, 'txid-dead', 'cafebabe', 500, [{ txid: 'prev', vout: 3 }]);
    payments.resetExpired(row.id, 'txid-dead');
    expect(payments.spentOutpoints().has('prev:3')).toBe(false);
    const requeued = payments.nextPending();
    expect(requeued?.id).toBe(row.id);
    expect(requeued?.txid).toBeNull();
    expect(requeued?.raw_hex).toBeNull();
  });

  it('recordFailure applies growing backoff and keeps the row pending', () => {
    const { payments } = fresh();
    payments.insertIdempotent({
      rail: 'stripe',
      eventKey: 'in_9',
      externalRef: 's',
      paymentCode: CODE,
      days: 30,
      fluxZats: 20e8,
    });
    const row = payments.nextPending()!;
    payments.recordFailure(row.id, row.attempts, 'explorer down');
    // Backed off: not immediately eligible again.
    expect(payments.nextPending()).toBeUndefined();
    const stats = payments.queueStats();
    expect(stats.pending).toBe(1);
  });

  it('apple token map round-trips case-insensitively', () => {
    const { subs } = fresh();
    subs.mapAppleToken('ABCDEF01-2345-4678-89AB-CDEF01234567', CODE);
    expect(subs.codeForAppleToken('abcdef01-2345-4678-89ab-cdef01234567')).toBe(CODE);
  });

  it('subscription upsert reactivates and setStatus transitions', () => {
    const { subs } = fresh();
    subs.upsert('stripe', 'sub_1', CODE, 'monthly');
    subs.setStatus('stripe', 'sub_1', 'canceled');
    expect(subs.get('stripe', 'sub_1')?.status).toBe('canceled');
    subs.upsert('stripe', 'sub_1', CODE, 'annual');
    const row = subs.get('stripe', 'sub_1');
    expect(row?.status).toBe('active');
    expect(row?.plan).toBe('annual');
  });
});

describe('migration 2 upgrade', () => {
  it('converts a v1 months database to days and admits the voucher rail', () => {
    // Build a v1 database by hand (schema as shipped in MIGRATIONS[0]),
    // seed a months row, then apply migration 2 the same way db.ts does.
    const raw = new Database(':memory:');
    raw.pragma('journal_mode = WAL');
    raw.exec(MIGRATIONS[0]!);
    raw.pragma('user_version = 1');
    raw
      .prepare(
        `INSERT INTO payments (rail, event_key, external_ref, payment_code, months, flux_zats, created_at)
         VALUES ('stripe', 'in_old', 'sub_old', 'CODEOLD', 12, 24000000000, 1700000000)`,
      )
      .run();
    raw.transaction(() => {
      raw.exec(MIGRATIONS[1]!);
      raw.pragma('user_version = 2');
    })();

    const row = raw.prepare(`SELECT * FROM payments WHERE event_key = 'in_old'`).get() as {
      days: number;
      flux_zats: number;
    };
    expect(row.days).toBe(360); // months * 30 preserved
    expect(row.flux_zats).toBe(24000000000);
    // voucher rail now admitted
    raw
      .prepare(
        `INSERT INTO payments (rail, event_key, external_ref, payment_code, days, flux_zats, created_at)
         VALUES ('voucher', '1:CODE', 'voucher:X', 'CODE', 7, 466666667, 1700000001)`,
      )
      .run();
    expect((raw.prepare(`SELECT COUNT(*) c FROM payments`).get() as { c: number }).c).toBe(2);
    // vouchers tables exist with the double-redeem UNIQUE
    raw
      .prepare(
        `INSERT INTO vouchers (code, type, value, created_at) VALUES ('ABC', 'grant_days', 7, 1)`,
      )
      .run();
    raw
      .prepare(
        `INSERT INTO voucher_redemptions (voucher_id, payment_code, redeemed_at) VALUES (1, 'CODE', 1)`,
      )
      .run();
    expect(() =>
      raw
        .prepare(
          `INSERT INTO voucher_redemptions (voucher_id, payment_code, redeemed_at) VALUES (1, 'CODE', 2)`,
        )
        .run(),
    ).toThrow(/UNIQUE/);
  });
});
