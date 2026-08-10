import { describe, expect, it } from 'vitest';
import { base58 } from '@scure/base';

import { openDb } from '../src/db/db.js';
import { PaymentsRepo } from '../src/db/payments.js';
import { recordGrant } from '../src/grants.js';

const VALID = base58.encode(new Uint8Array(20).fill(5));

describe('recordGrant', () => {
  it('validates the code before anything reaches the queue', () => {
    const payments = new PaymentsRepo(openDb(':memory:'));
    expect(
      recordGrant(payments, 20e8, {
        rail: 'apple',
        eventKey: 't1',
        externalRef: 'o1',
        paymentCode: 'nonsense',
        months: 1,
      }),
    ).toBe('invalid_code');
    expect(payments.queueStats().pending).toBe(0);
  });

  it('queues and deduplicates', () => {
    const payments = new PaymentsRepo(openDb(':memory:'));
    const ev = {
      rail: 'google' as const,
      eventKey: 'GPA.1-0',
      externalRef: 'tok',
      paymentCode: VALID,
      months: 12,
    };
    expect(recordGrant(payments, 20e8, ev)).toBe('queued');
    expect(recordGrant(payments, 20e8, ev)).toBe('duplicate');
    const row = payments.byCode(VALID)[0]!;
    expect(row.flux_zats).toBe(12 * 20e8);
  });
});
