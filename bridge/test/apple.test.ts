import { describe, expect, it } from 'vitest';
import { base58 } from '@scure/base';
import type { FastifyBaseLogger } from 'fastify';

import { openDb } from '../src/db/db.js';
import { PaymentsRepo } from '../src/db/payments.js';
import { SubscriptionsRepo } from '../src/db/subscriptions.js';
import { AppleRail } from '../src/rails/apple.js';
import type { AppleConfig } from '../src/config.js';

const CODE = base58.encode(new Uint8Array(20).fill(7));
const PRICE_ZATS = 20e8;

const nullLog = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
  fatal: () => undefined,
  silent: () => undefined,
  level: 'silent',
  child: function () {
    return this;
  },
} as unknown as FastifyBaseLogger;

/**
 * Sandbox environment on purpose: it is the only one SignedDataVerifier will
 * build without a numeric app id, and these tests exercise the grant-sizing
 * logic rather than JWS verification (which needs Apple-signed payloads we
 * cannot mint).
 */
function cfgWith(sandboxGrantDays: number): AppleConfig {
  return {
    bundleId: 'com.cumulusvpn.app',
    appAppleId: undefined,
    environment: 'Sandbox',
    allowSandbox: true,
    sandboxGrants: false,
    sandboxGrantDays,
    rootCaDir: new URL('../certs', import.meta.url).pathname,
    productMonthly: 'cvpn.premium.monthly',
    productAnnual: 'cvpn.premium.annual',
  };
}

/** `sandboxGrant` is private only to TypeScript; it is a plain method at runtime. */
type Probe = {
  sandboxGrant: (
    transactionId: string,
    originalTransactionId: string,
    code: string,
  ) => { accepted: boolean; reason: string; days?: number; sandbox?: boolean };
  daysForProduct: (productId: string | undefined) => number | null;
};

function setup(sandboxGrantDays = 1): { rail: AppleRail & Probe; payments: PaymentsRepo } {
  const db = openDb(':memory:');
  const payments = new PaymentsRepo(db);
  const subs = new SubscriptionsRepo(db);
  const rail = new AppleRail(cfgWith(sandboxGrantDays), PRICE_ZATS, payments, subs, nullLog);
  return { rail: rail as AppleRail & Probe, payments };
}

describe('apple: product mapping', () => {
  it('maps the two configured products and rejects anything else', () => {
    const { rail } = setup();
    expect(rail.daysForProduct('cvpn.premium.monthly')).toBe(30);
    expect(rail.daysForProduct('cvpn.premium.annual')).toBe(360);
    expect(rail.daysForProduct('cvpn.premium.weekly')).toBeNull();
    expect(rail.daysForProduct(undefined)).toBeNull();
  });
});

describe('apple: bounded sandbox grants', () => {
  it('settles a sandbox purchase so App Review actually sees premium unlock', () => {
    const { rail, payments } = setup(1);
    const out = rail.sandboxGrant('txn-1', 'orig-1', CODE);
    expect(out.accepted).toBe(true);
    expect(out.sandbox).toBe(true);
    expect(out.days).toBe(1);

    const rows = payments.byCode(CODE);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.days).toBe(1);
    // ceil(price * days / 30) — one day of a 20 FLUX month.
    expect(rows[0]!.flux_zats).toBe(Math.ceil((PRICE_ZATS * 1) / 30));
  });

  it('settles AT MOST once per subscription, however many renewals arrive', () => {
    const { rail, payments } = setup(1);
    // The sandbox clock renews every few minutes; each renewal is a NEW
    // transactionId under the SAME originalTransactionId. Keying on the
    // original is what stops an idle test device draining the treasury.
    for (const txn of ['txn-1', 'txn-2', 'txn-3', 'txn-4', 'txn-5']) {
      rail.sandboxGrant(txn, 'orig-1', CODE);
    }
    expect(payments.byCode(CODE)).toHaveLength(1);
  });

  it('treats a distinct test subscription as a distinct grant', () => {
    const { rail, payments } = setup(1);
    rail.sandboxGrant('txn-1', 'orig-1', CODE);
    rail.sandboxGrant('txn-9', 'orig-2', CODE);
    expect(payments.byCode(CODE)).toHaveLength(2);
  });

  it('grants nothing when the probe is disabled, but still accepts the purchase', () => {
    const { rail, payments } = setup(0);
    const out = rail.sandboxGrant('txn-1', 'orig-1', CODE);
    expect(out.accepted).toBe(true);
    expect(out.reason).toBe('sandbox_verified');
    expect(payments.byCode(CODE)).toHaveLength(0);
  });

  it('never grants a full month by accident', () => {
    const { rail, payments } = setup(1);
    rail.sandboxGrant('txn-1', 'orig-1', CODE);
    const row = payments.byCode(CODE)[0]!;
    expect(row.flux_zats).toBeLessThan(PRICE_ZATS);
    expect(row.days).toBeLessThan(30);
  });
});
