import { describe, expect, it } from 'vitest';

import { openDb } from '../src/db/db.js';
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
      months: 1,
      fluxZats: 20e8,
    };
    expect(payments.insertIdempotent(p)).not.toBeNull();
    expect(payments.insertIdempotent(p)).toBeNull();
    expect(payments.insertIdempotent({ ...p, months: 12 })).toBeNull(); // even with different payload
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
      months: 1,
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
      months: 12,
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
      months: 1,
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
