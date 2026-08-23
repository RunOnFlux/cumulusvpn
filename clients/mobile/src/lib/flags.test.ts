import { resolveFlags, DEFAULT_FLAGS } from './flags';

describe('resolveFlags', () => {
  const doc = { inAppUpgrade: { android: true, ios: false } };

  it('grants a feature only for the platform set true', () => {
    expect(resolveFlags(doc, 'android').inAppUpgrade).toBe(true);
    expect(resolveFlags(doc, 'ios').inAppUpgrade).toBe(false);
  });

  it('is OFF for an unknown platform', () => {
    expect(resolveFlags(doc, 'web').inAppUpgrade).toBe(false);
  });

  it('honours the remote doc on iOS too — no build-level allowlist', () => {
    // iOS was once excluded in code, so changing the decision meant shipping a
    // binary. The per-platform KV key is the gate now; it still fails closed.
    expect(resolveFlags({ inAppUpgrade: { android: true, ios: true } }, 'ios').inAppUpgrade).toBe(
      true,
    );
    expect(resolveFlags({ inAppUpgrade: { android: true, ios: false } }, 'ios').inAppUpgrade).toBe(
      false,
    );
  });

  it('is OFF for a malformed / empty doc', () => {
    expect(resolveFlags(null, 'android').inAppUpgrade).toBe(false);
    expect(resolveFlags({}, 'android').inAppUpgrade).toBe(false);
    expect(resolveFlags({ inAppUpgrade: true }, 'android').inAppUpgrade).toBe(false);
    expect(resolveFlags('nope', 'android').inAppUpgrade).toBe(false);
  });

  it('treats non-true values as OFF (only strict true enables)', () => {
    expect(resolveFlags({ inAppUpgrade: { android: 'yes' } }, 'android').inAppUpgrade).toBe(false);
    expect(resolveFlags({ inAppUpgrade: { android: 1 } }, 'android').inAppUpgrade).toBe(false);
  });

  it('DEFAULT_FLAGS has everything off', () => {
    expect(DEFAULT_FLAGS.inAppUpgrade).toBe(false);
    expect(DEFAULT_FLAGS.iapPurchase).toBe(false);
    expect(DEFAULT_FLAGS.voucherRedeem).toBe(false);
  });
});

describe('resolveFlags: iapPurchase', () => {
  const doc = { iapPurchase: { android: true, ios: true } };

  it('is allowed on BOTH platforms (store billing is store-compliant)', () => {
    expect(resolveFlags(doc, 'ios').iapPurchase).toBe(true);
    expect(resolveFlags(doc, 'android').iapPurchase).toBe(true);
  });

  it('is per-platform and strict-true like every flag', () => {
    expect(resolveFlags({ iapPurchase: { android: true } }, 'ios').iapPurchase).toBe(false);
    expect(resolveFlags({ iapPurchase: { ios: 'yes' } }, 'ios').iapPurchase).toBe(false);
    expect(resolveFlags({}, 'ios').iapPurchase).toBe(false);
    expect(resolveFlags(null, 'android').iapPurchase).toBe(false);
  });

  it('is OFF for an unknown platform', () => {
    expect(resolveFlags(doc, 'web').iapPurchase).toBe(false);
  });

  it('the two purchase flags stay independent', () => {
    const both = { inAppUpgrade: { android: true }, iapPurchase: { ios: true } };
    expect(resolveFlags(both, 'android')).toEqual({
      inAppUpgrade: true,
      iapPurchase: false,
      voucherRedeem: false,
    });
    expect(resolveFlags(both, 'ios')).toEqual({
      inAppUpgrade: false,
      iapPurchase: true,
      voucherRedeem: false,
    });
  });

  it('crypto and store billing are independently settable on iOS', () => {
    const doc2 = { inAppUpgrade: { ios: true }, iapPurchase: { ios: true } };
    expect(resolveFlags(doc2, 'ios').inAppUpgrade).toBe(true);
    expect(resolveFlags(doc2, 'ios').iapPurchase).toBe(true);
    const iapOnly = { inAppUpgrade: { ios: false }, iapPurchase: { ios: true } };
    expect(resolveFlags(iapOnly, 'ios').inAppUpgrade).toBe(false);
    expect(resolveFlags(iapOnly, 'ios').iapPurchase).toBe(true);
  });
});

describe('resolveFlags: voucherRedeem', () => {
  it('is remote-controlled on iOS as well as android', () => {
    const doc = { voucherRedeem: { android: true, ios: true } };
    expect(resolveFlags(doc, 'ios').voucherRedeem).toBe(true);
    expect(resolveFlags(doc, 'android').voucherRedeem).toBe(true);
    expect(resolveFlags({ voucherRedeem: { ios: false } }, 'ios').voucherRedeem).toBe(false);
  });

  it('is strict-true, per-platform, fail-closed like every flag', () => {
    expect(resolveFlags({ voucherRedeem: { android: 'yes' } }, 'android').voucherRedeem).toBe(
      false,
    );
    expect(resolveFlags({}, 'android').voucherRedeem).toBe(false);
    expect(resolveFlags(null, 'android').voucherRedeem).toBe(false);
  });
});
