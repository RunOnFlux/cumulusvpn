import { describe, expect, it } from 'vitest';
import { base58 } from '@scure/base';
import type { FastifyBaseLogger } from 'fastify';

import { openDb } from '../src/db/db.js';
import { PaymentsRepo } from '../src/db/payments.js';
import { SubscriptionsRepo } from '../src/db/subscriptions.js';
import { GoogleRail } from '../src/rails/google.js';
import type { GoogleConfig } from '../src/config.js';

const CODE = base58.encode(new Uint8Array(20).fill(11));
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

/** Structurally valid service-account JSON; never used to reach the network here. */
const FAKE_SA = JSON.stringify({
  type: 'service_account',
  project_id: 'cumulusvpn-test',
  client_email: 'test@cumulusvpn-test.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----\n',
});

function cfgWith(testGrantDays: number): GoogleConfig {
  return {
    packageName: 'com.cumulusvpn.app',
    serviceAccountJson: FAKE_SA,
    rtdnAudience: 'https://pay.cumulusvpn.com/v1/google/rtdn',
    rtdnEmail: 'rtdn@cumulusvpn-test.iam.gserviceaccount.com',
    basePlanMonthly: 'premium-monthly',
    basePlanAnnual: 'premium-annual',
    testGrants: false,
    testGrantDays,
  };
}

/** `testGrant` is private only to TypeScript; a plain method at runtime. */
type Probe = {
  testGrant: (
    purchaseToken: string,
    code: string,
    orderId: string,
  ) => { accepted: boolean; reason: string; days?: number; test?: boolean };
  daysForBasePlan: (basePlanId: string | null | undefined) => number | null;
};

function setup(testGrantDays = 1): { rail: GoogleRail & Probe; payments: PaymentsRepo } {
  const db = openDb(':memory:');
  const payments = new PaymentsRepo(db);
  const subs = new SubscriptionsRepo(db);
  const rail = new GoogleRail(cfgWith(testGrantDays), PRICE_ZATS, payments, subs, nullLog);
  return { rail: rail as GoogleRail & Probe, payments };
}

describe('google: base plan mapping', () => {
  it('maps the two configured base plans and rejects anything else', () => {
    const { rail } = setup();
    expect(rail.daysForBasePlan('premium-monthly')).toBe(30);
    expect(rail.daysForBasePlan('premium-annual')).toBe(360);
    expect(rail.daysForBasePlan('premium-weekly')).toBeNull();
    expect(rail.daysForBasePlan(null)).toBeNull();
    expect(rail.daysForBasePlan(undefined)).toBeNull();
  });
});

describe('google: bounded test grants', () => {
  it('settles a license-tester purchase so closed-test users see premium unlock', () => {
    const { rail, payments } = setup(1);
    const out = rail.testGrant('token-1', CODE, 'GPA.1111-2222-3333-44444');
    expect(out.accepted).toBe(true);
    expect(out.test).toBe(true);
    expect(out.days).toBe(1);

    const rows = payments.byCode(CODE);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.flux_zats).toBe(Math.ceil((PRICE_ZATS * 1) / 30));
  });

  it('settles AT MOST once per subscription across renewals', () => {
    const { rail, payments } = setup(1);
    // purchaseToken is stable across renewals; latestSuccessfulOrderId is not
    // (GPA…-0, -1, -2). Keying on the token is what bounds the spend.
    for (const order of ['GPA.x-0', 'GPA.x-1', 'GPA.x-2']) {
      rail.testGrant('token-1', CODE, order);
    }
    expect(payments.byCode(CODE)).toHaveLength(1);
  });

  it('treats a distinct purchase token as a distinct grant', () => {
    const { rail, payments } = setup(1);
    rail.testGrant('token-1', CODE, 'GPA.x-0');
    rail.testGrant('token-2', CODE, 'GPA.y-0');
    expect(payments.byCode(CODE)).toHaveLength(2);
  });

  it('grants nothing when the probe is disabled, but still accepts the purchase', () => {
    const { rail, payments } = setup(0);
    const out = rail.testGrant('token-1', CODE, 'GPA.x-0');
    expect(out.accepted).toBe(true);
    expect(out.reason).toBe('test_verified');
    expect(payments.byCode(CODE)).toHaveLength(0);
  });

  it('never grants a full month by accident', () => {
    const { rail, payments } = setup(1);
    rail.testGrant('token-1', CODE, 'GPA.x-0');
    const row = payments.byCode(CODE)[0]!;
    expect(row.flux_zats).toBeLessThan(PRICE_ZATS);
    expect(row.days).toBeLessThan(30);
  });
});
