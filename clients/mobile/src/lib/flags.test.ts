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
  });
});
