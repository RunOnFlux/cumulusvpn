import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { base58 } from '@scure/base';
import type { FastifyBaseLogger } from 'fastify';

import { openDb } from '../src/db/db.js';
import { PaymentsRepo } from '../src/db/payments.js';
import { SubscriptionsRepo } from '../src/db/subscriptions.js';
import { AppleRail } from '../src/rails/apple.js';
import { uuidForCode } from '../src/codes.js';
import type { AppleConfig } from '../src/config.js';

const CODE = base58.encode(new Uint8Array(20).fill(7));
/** A second device of the same Apple ID — a reinstall, or a new phone. */
const NEW_CODE = base58.encode(new Uint8Array(20).fill(8));
const PRICE_ZATS = 20e8;
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 30, 12, 0, 0);
const ORIG = '2000000123456789';

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

/** A decoded StoreKit transaction, as the JWS verifier would hand it back. */
interface Txn {
  transactionId?: string;
  originalTransactionId?: string;
  productId?: string;
  appAccountToken?: string;
  expiresDate?: number;
  purchaseDate?: number;
  transactionReason?: string;
  revocationDate?: number;
  isUpgraded?: boolean;
}

function txn(over: Txn = {}): Txn {
  return {
    transactionId: '2000000000000001',
    originalTransactionId: ORIG,
    productId: 'cvpn.premium.monthly',
    appAccountToken: uuidForCode(CODE),
    expiresDate: NOW + 10 * DAY,
    purchaseDate: NOW - 20 * DAY,
    transactionReason: 'PURCHASE',
    ...over,
  };
}

/**
 * A rail whose JWS verification is stubbed: we cannot mint Apple-signed
 * payloads, and these tests are about ownership, not signatures. `sandbox`
 * says which verifier "accepted" it.
 */
function setupStore(sandboxGrantDays = 1): {
  rail: AppleRail;
  payments: PaymentsRepo;
  subs: SubscriptionsRepo;
  present: (t: Txn | null, sandbox?: boolean) => void;
  notify: (type: string, t: Txn, sandbox?: boolean) => Promise<string>;
} {
  const db = openDb(':memory:');
  const payments = new PaymentsRepo(db);
  const subs = new SubscriptionsRepo(db);
  const rail = new AppleRail(cfgWith(sandboxGrantDays), PRICE_ZATS, payments, subs, nullLog);
  const stub = rail as unknown as {
    decodeTransaction: () => Promise<{ txn: Txn | null; sandbox: boolean }>;
    decodeNotification: () => Promise<{ payload: object; sandbox: boolean }>;
  };
  const present = (t: Txn | null, sandbox = false): void => {
    stub.decodeTransaction = () => Promise.resolve({ txn: t, sandbox });
  };
  const notify = (type: string, t: Txn, sandbox = false): Promise<string> => {
    present(t, sandbox);
    stub.decodeNotification = () =>
      Promise.resolve({
        payload: { notificationType: type, data: { signedTransactionInfo: 'jws' } },
        sandbox,
      });
    return rail.handleNotification('signed-payload');
  };
  return { rail, payments, subs, present, notify };
}

function keys(payments: PaymentsRepo, code: string): string[] {
  return payments.byCode(code, 100).map((r) => r.event_key);
}

describe('apple: claims', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('binds an App Store offer-code redemption (no token) to its first claimant', async () => {
    const { rail, payments, subs, present } = setupStore();
    present(txn({ appAccountToken: undefined }));
    const out = await rail.claimPurchase(NEW_CODE, 'jws', false);
    expect(out).toMatchObject({ accepted: true, days: 30, transferred: false, test: false });
    expect(subs.get('apple', ORIG)?.payment_code).toBe(NEW_CODE);
    expect(keys(payments, NEW_CODE)).toEqual(['2000000000000001']);
    expect(subs.get('apple', ORIG)?.transferred_at).toBeNull();
  });

  it('leaves the strict verify path rejecting that same transaction', async () => {
    const { rail, payments, present } = setupStore();
    present(txn({ appAccountToken: undefined }));
    expect(await rail.verifyPurchase(NEW_CODE, 'jws')).toMatchObject({
      accepted: false,
      reason: 'app_account_token_mismatch',
    });
    expect(payments.byCode(NEW_CODE)).toHaveLength(0);
  });

  it('refuses a subscription bound elsewhere unless the user confirms', async () => {
    const { rail, payments, subs, present } = setupStore();
    present(txn());
    await rail.verifyPurchase(CODE, 'jws');
    expect(await rail.claimPurchase(NEW_CODE, 'jws', false)).toEqual({
      accepted: false,
      reason: 'owned_by_other_device',
    });
    expect(subs.get('apple', ORIG)?.payment_code).toBe(CODE);
    expect(payments.byCode(NEW_CODE)).toHaveLength(0);
  });

  it('transfers on confirmation, granting the rest of the period once', async () => {
    const { rail, payments, subs, present } = setupStore();
    present(txn());
    await rail.verifyPurchase(CODE, 'jws');
    const out = await rail.claimPurchase(NEW_CODE, 'jws', true);
    expect(out).toMatchObject({ accepted: true, days: 10, transferred: true });
    expect(subs.get('apple', ORIG)).toMatchObject({
      payment_code: NEW_CODE,
      transferred_at: NOW / 1000,
    });
    expect(keys(payments, NEW_CODE)).toEqual([`transfer:${ORIG}:${NOW + 10 * DAY}`]);
    expect(await rail.claimPurchase(CODE, 'jws', true)).toMatchObject({
      reason: 'transfer_too_soon',
      availableAt: NOW / 1000 + 30 * 86_400,
    });
  });

  it('rejects an expired or revoked transaction — a claim can move a subscription', async () => {
    const { rail, present } = setupStore();
    present(txn({ expiresDate: NOW - 1 }));
    expect(await rail.claimPurchase(CODE, 'jws', true)).toMatchObject({ reason: 'expired' });
    present(txn({ revocationDate: NOW - DAY }));
    expect(await rail.claimPurchase(CODE, 'jws', true)).toMatchObject({ reason: 'revoked' });
    present(txn({ isUpgraded: true }));
    expect(await rail.claimPurchase(CODE, 'jws', true)).toMatchObject({ reason: 'revoked' });
  });

  it('settles a sandbox transfer with the bounded probe, not the remaining days', async () => {
    const { rail, payments, present } = setupStore(1);
    present(txn({ expiresDate: NOW + 20 * DAY }), true);
    await rail.verifyPurchase(CODE, 'jws');
    expect(await rail.claimPurchase(NEW_CODE, 'jws', true)).toMatchObject({
      accepted: true,
      days: 1,
      test: true,
    });
    expect(keys(payments, NEW_CODE)).toEqual([`sandbox-transfer:${ORIG}`]);
  });
});

describe('apple: renewals follow the binding', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const renewal = txn({
    transactionId: '2000000000000002',
    expiresDate: NOW + 40 * DAY,
    purchaseDate: NOW + 10 * DAY,
    transactionReason: 'RENEWAL',
  });

  it('credits the purchasing code before any transfer (unchanged)', async () => {
    const { rail, payments, present, notify } = setupStore();
    present(txn());
    await rail.verifyPurchase(CODE, 'jws');
    expect(await notify('DID_RENEW', renewal)).toBe('notification:queued');
    expect(keys(payments, CODE)).toContain('2000000000000002');
  });

  it('credits the NEW code after a transfer, though the token names the old one', async () => {
    const { rail, payments, subs, present, notify } = setupStore();
    present(txn());
    await rail.verifyPurchase(CODE, 'jws');
    await rail.claimPurchase(NEW_CODE, 'jws', true);
    expect(await notify('DID_RENEW', renewal)).toBe('notification:queued');
    expect(keys(payments, NEW_CODE)).toContain('2000000000000002');
    expect(keys(payments, CODE)).toEqual(['2000000000000001']);
    expect(subs.get('apple', ORIG)?.payment_code).toBe(NEW_CODE);
  });

  it('keeps the old device from pulling it back through verify', async () => {
    const { rail, payments, subs, present } = setupStore();
    present(txn());
    await rail.verifyPurchase(CODE, 'jws');
    await rail.claimPurchase(NEW_CODE, 'jws', true);
    present(renewal);
    expect(await rail.verifyPurchase(CODE, 'jws')).toMatchObject({ accepted: true });
    expect(subs.get('apple', ORIG)?.payment_code).toBe(NEW_CODE);
    expect(keys(payments, NEW_CODE)).toContain('2000000000000002');
  });

  it('gives a resubscribe made AFTER the move to whoever bought it', async () => {
    // Same original transaction, but a fresh purchase: the buyer owns it again.
    const { rail, payments, subs, present, notify } = setupStore();
    present(txn());
    await rail.verifyPurchase(CODE, 'jws');
    await rail.claimPurchase(NEW_CODE, 'jws', true);
    const resub = txn({
      transactionId: '2000000000000009',
      purchaseDate: NOW + 60 * DAY,
      expiresDate: NOW + 90 * DAY,
      transactionReason: 'PURCHASE',
    });
    vi.setSystemTime(NOW + 60 * DAY);
    expect(await notify('SUBSCRIBED', resub)).toBe('notification:queued');
    expect(keys(payments, CODE)).toContain('2000000000000009');
    expect(subs.get('apple', ORIG)?.payment_code).toBe(CODE);
  });

  it('lets support grant the rest of the period from the last verified transaction', async () => {
    const { rail, payments, subs, present } = setupStore();
    present(txn());
    await rail.verifyPurchase(CODE, 'jws');
    expect(subs.get('apple', ORIG)).toMatchObject({
      apple_expires_ms: NOW + 10 * DAY,
      apple_sandbox: 0,
    });
    const out = rail.adminRebind(ORIG, NEW_CODE, true);
    expect(out).toMatchObject({ ok: true, previousCode: CODE, days: 10, grant: 'queued' });
    // Same key a user transfer would use: a second support grant is a no-op.
    expect(rail.adminRebind(ORIG, CODE, true)).toMatchObject({ grant: 'duplicate' });
    expect(keys(payments, NEW_CODE)).toEqual([`transfer:${ORIG}:${NOW + 10 * DAY}`]);
  });

  it('refuses a support grant once the last known period has ended', () => {
    const { rail, subs } = setupStore();
    subs.upsert('apple', ORIG, CODE, 'monthly');
    expect(rail.adminRebind(ORIG, NEW_CODE, true)).toEqual({
      ok: false,
      reason: 'no_current_period',
    });
    // ...but can still move it without a grant.
    expect(rail.adminRebind(ORIG, NEW_CODE, false)).toMatchObject({ ok: true, days: 0 });
    expect(subs.get('apple', ORIG)?.payment_code).toBe(NEW_CODE);
  });
});
