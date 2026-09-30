import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { base58 } from '@scure/base';
import type { FastifyBaseLogger } from 'fastify';

import { openDb } from '../src/db/db.js';
import { PaymentsRepo } from '../src/db/payments.js';
import { SubscriptionsRepo } from '../src/db/subscriptions.js';
import { GoogleRail } from '../src/rails/google.js';
import type { GoogleConfig } from '../src/config.js';

const CODE = base58.encode(new Uint8Array(20).fill(11));
/** A second device of the same Play account — a reinstall, or a new phone. */
const NEW_CODE = base58.encode(new Uint8Array(20).fill(12));
const PRICE_ZATS = 20e8;
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 30, 12, 0, 0);
const TOKEN = 'play-purchase-token-0123456789';

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

/** What `purchases.subscriptionsv2.get` answers — mutable, so a test can renew it. */
interface PlaySub {
  account?: string | null;
  order?: string;
  expiryMs?: number;
  basePlan?: string;
  state?: string;
  test?: boolean;
  ackPending?: boolean;
}

function playPayload(p: PlaySub): object {
  return {
    subscriptionState: p.state ?? 'SUBSCRIPTION_STATE_ACTIVE',
    acknowledgementState: p.ackPending
      ? 'ACKNOWLEDGEMENT_STATE_PENDING'
      : 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
    // null = a promo code redeemed in the Play Store: no account id at all.
    ...(p.account === null
      ? {}
      : { externalAccountIdentifiers: { obfuscatedExternalAccountId: p.account ?? CODE } }),
    lineItems: [
      {
        productId: 'premium',
        offerDetails: { basePlanId: p.basePlan ?? 'premium-monthly' },
        latestSuccessfulOrderId: p.order ?? 'GPA.1111-0',
        expiryTime: new Date(p.expiryMs ?? NOW + 10 * DAY).toISOString(),
      },
    ],
    ...(p.test ? { testPurchase: {} } : {}),
  };
}

/** A rail whose Play Developer API is a stub answering from `play`. */
function setupPlay(
  play: PlaySub = {},
  over: Partial<GoogleConfig> = {},
): {
  rail: GoogleRail;
  payments: PaymentsRepo;
  subs: SubscriptionsRepo;
  play: PlaySub;
  acks: string[];
} {
  const db = openDb(':memory:');
  const payments = new PaymentsRepo(db);
  const subs = new SubscriptionsRepo(db);
  const rail = new GoogleRail({ ...cfgWith(1), ...over }, PRICE_ZATS, payments, subs, nullLog);
  const acks: string[] = [];
  (rail as unknown as { publisher: unknown }).publisher = {
    purchases: {
      subscriptionsv2: { get: () => Promise.resolve({ data: playPayload(play) }) },
      subscriptions: {
        acknowledge: (args: { token: string }) => {
          acks.push(args.token);
          return Promise.resolve({});
        },
      },
    },
  };
  return { rail, payments, subs, play, acks };
}

/** An authenticated RTDN push body, as handleRtdn receives it. */
function rtdn(notificationType: number, token = TOKEN): string {
  return Buffer.from(
    JSON.stringify({
      packageName: 'com.cumulusvpn.app',
      subscriptionNotification: { notificationType, purchaseToken: token },
    }),
  ).toString('base64');
}

function rawPayments(payments: PaymentsRepo, code: string): { event_key: string; days: number }[] {
  return payments.byCode(code, 100).map((r) => ({ event_key: r.event_key, days: r.days }));
}

describe('google: claims', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('binds a Play-Store promo redemption (no account id) to its first claimant', async () => {
    const { rail, payments, subs, acks } = setupPlay({ account: null, ackPending: true });
    const out = await rail.claimPurchase(NEW_CODE, TOKEN, false);
    expect(out).toMatchObject({ accepted: true, days: 30, transferred: false, test: false });
    expect(subs.get('google', TOKEN)?.payment_code).toBe(NEW_CODE);
    // Granted exactly as verify would: the current period, keyed by order id.
    expect(rawPayments(payments, NEW_CODE)).toEqual([{ event_key: 'GPA.1111-0', days: 30 }]);
    // Play refunds an unacknowledged purchase after 3 days — the claim acks it.
    expect(acks).toEqual([TOKEN]);
    // Not a transfer: the 30-day clock is untouched.
    expect(subs.get('google', TOKEN)?.transferred_at).toBeNull();
  });

  it('leaves the strict verify path rejecting that same purchase', async () => {
    const { rail, payments } = setupPlay({ account: null });
    expect(await rail.verifyPurchase(NEW_CODE, TOKEN)).toMatchObject({
      accepted: false,
      reason: 'account_id_missing',
    });
    expect(payments.byCode(NEW_CODE)).toHaveLength(0);
  });

  it('behaves exactly like verify for the code that bought it (idempotent)', async () => {
    const { rail, payments } = setupPlay();
    await rail.verifyPurchase(CODE, TOKEN);
    const out = await rail.claimPurchase(CODE, TOKEN, false);
    expect(out).toMatchObject({ accepted: true, reason: 'duplicate', transferred: false });
    expect(payments.byCode(CODE)).toHaveLength(1);
  });

  it('refuses to silently take a subscription another device owns', async () => {
    const { rail, payments, subs } = setupPlay();
    await rail.verifyPurchase(CODE, TOKEN);
    const out = await rail.claimPurchase(NEW_CODE, TOKEN, false);
    expect(out).toEqual({ accepted: false, reason: 'owned_by_other_device' });
    expect(subs.get('google', TOKEN)?.payment_code).toBe(CODE);
    expect(payments.byCode(NEW_CODE)).toHaveLength(0);
  });

  it('treats an unverified purchase stamped with another code as owned too', async () => {
    // Bought on a device whose verify never reached us: no binding, but the
    // account id names a different code — still a move, never a silent grab.
    const { rail, subs } = setupPlay({ account: CODE });
    expect(await rail.claimPurchase(NEW_CODE, TOKEN, false)).toMatchObject({
      reason: 'owned_by_other_device',
    });
    expect(subs.get('google', TOKEN)).toBeUndefined();
  });

  it('transfers on confirmation: rebinds and grants the rest of the period', async () => {
    const { rail, payments, subs } = setupPlay({ expiryMs: NOW + 10 * DAY });
    await rail.verifyPurchase(CODE, TOKEN);
    const out = await rail.claimPurchase(NEW_CODE, TOKEN, true);
    expect(out).toMatchObject({ accepted: true, days: 10, transferred: true, test: false });
    expect(subs.get('google', TOKEN)).toMatchObject({
      payment_code: NEW_CODE,
      transferred_at: NOW / 1000,
    });
    expect(rawPayments(payments, NEW_CODE)).toEqual([
      { event_key: `transfer:${TOKEN}:${NOW + 10 * DAY}`, days: 10 },
    ]);
    // The old code keeps what it already had — chain grants are irrevocable.
    expect(payments.byCode(CODE)).toHaveLength(1);
    expect(subs.transfersForCode(CODE)).toMatchObject([
      { from_code: CODE, to_code: NEW_CODE, actor: 'user', days: 10 },
    ]);
  });

  it('allows one transfer per subscription per 30 days', async () => {
    const { rail, subs } = setupPlay();
    await rail.verifyPurchase(CODE, TOKEN);
    await rail.claimPurchase(NEW_CODE, TOKEN, true);
    const back = await rail.claimPurchase(CODE, TOKEN, true);
    expect(back).toEqual({
      accepted: false,
      reason: 'transfer_too_soon',
      availableAt: NOW / 1000 + 30 * 86_400,
    });
    expect(subs.get('google', TOKEN)?.payment_code).toBe(NEW_CODE);
  });

  it('never grants one billing period twice, even after the rate limit lapses', async () => {
    // An annual period outlives the 30-day limit, so A→B, then B→A a month
    // later, is the same period both times — the per-period key collapses it.
    const expiryMs = NOW + 300 * DAY;
    const { rail, payments } = setupPlay({ basePlan: 'premium-annual', expiryMs });
    await rail.verifyPurchase(CODE, TOKEN);
    expect(await rail.claimPurchase(NEW_CODE, TOKEN, true)).toMatchObject({ days: 300 });
    vi.setSystemTime(NOW + 31 * DAY);
    const back = await rail.claimPurchase(CODE, TOKEN, true);
    expect(back).toMatchObject({ accepted: true, transferred: true, reason: 'transfer:duplicate' });
    // Only the original purchase grant for CODE — no second transfer grant.
    expect(rawPayments(payments, CODE)).toEqual([{ event_key: 'GPA.1111-0', days: 360 }]);
  });

  it('settles a license-tester transfer with the bounded probe, once', async () => {
    const { rail, payments } = setupPlay({ test: true });
    await rail.verifyPurchase(CODE, TOKEN);
    expect(await rail.claimPurchase(NEW_CODE, TOKEN, true)).toMatchObject({
      accepted: true,
      days: 1,
      test: true,
      transferred: true,
    });
    vi.setSystemTime(NOW + 31 * DAY);
    await rail.claimPurchase(CODE, TOKEN, true);
    const probes = [...rawPayments(payments, CODE), ...rawPayments(payments, NEW_CODE)].filter(
      (p) => p.event_key.startsWith('test-transfer:'),
    );
    expect(probes).toEqual([{ event_key: `test-transfer:${TOKEN}`, days: 1 }]);
  });

  it('shares the per-period key with a support rebind', async () => {
    const { rail, payments } = setupPlay();
    await rail.verifyPurchase(CODE, TOKEN);
    await rail.claimPurchase(NEW_CODE, TOKEN, true);
    const out = await rail.adminRebind(TOKEN, CODE, true);
    expect(out).toMatchObject({ ok: true, previousCode: NEW_CODE, grant: 'duplicate' });
    expect(rawPayments(payments, CODE)).toEqual([{ event_key: 'GPA.1111-0', days: 30 }]);
  });
});

describe('google: renewals follow the binding', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('credits the purchasing code before any transfer (unchanged)', async () => {
    const { rail, payments, play } = setupPlay();
    await rail.verifyPurchase(CODE, TOKEN);
    play.order = 'GPA.1111-1';
    expect(await rail.handleRtdn(rtdn(2))).toBe('rtdn:queued');
    expect(rawPayments(payments, CODE).map((p) => p.event_key)).toEqual([
      'GPA.1111-1',
      'GPA.1111-0',
    ]);
  });

  it('credits the NEW code after a transfer, though the account id names the old one', async () => {
    const { rail, payments, subs, play } = setupPlay();
    await rail.verifyPurchase(CODE, TOKEN);
    await rail.claimPurchase(NEW_CODE, TOKEN, true);
    play.order = 'GPA.1111-1';
    play.expiryMs = NOW + 40 * DAY;
    expect(await rail.handleRtdn(rtdn(2))).toBe('rtdn:queued');
    expect(rawPayments(payments, NEW_CODE).map((p) => p.event_key)).toContain('GPA.1111-1');
    expect(rawPayments(payments, CODE).map((p) => p.event_key)).toEqual(['GPA.1111-0']);
    expect(subs.get('google', TOKEN)?.payment_code).toBe(NEW_CODE);
  });

  it('keeps the old device from pulling it back through verify', async () => {
    // Its app re-verifies held purchases on every launch, and the account id
    // still matches it — that must not undo the move past the 30-day limit.
    const { rail, payments, subs, play } = setupPlay();
    await rail.verifyPurchase(CODE, TOKEN);
    await rail.claimPurchase(NEW_CODE, TOKEN, true);
    play.order = 'GPA.1111-1';
    expect(await rail.verifyPurchase(CODE, TOKEN)).toMatchObject({ accepted: true });
    expect(subs.get('google', TOKEN)?.payment_code).toBe(NEW_CODE);
    expect(rawPayments(payments, NEW_CODE).map((p) => p.event_key)).toContain('GPA.1111-1');
    expect(rawPayments(payments, CODE).map((p) => p.event_key)).toEqual(['GPA.1111-0']);
  });
});
