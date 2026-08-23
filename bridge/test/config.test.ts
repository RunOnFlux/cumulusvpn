import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';

/** Minimum env for a bootable bridge; rails are added per test. */
const BASE: NodeJS.ProcessEnv = {
  PAYMENT_ADDRESS: 't3disq3aZz8K3RLZL9zfkpP2UWNVV3hq4vZ',
  TREASURY_WIF: 'not-a-real-wif',
  ADMIN_TOKEN: 'admin-token',
};

const APPLE: NodeJS.ProcessEnv = {
  ...BASE,
  APPLE_BUNDLE_ID: 'com.cumulusvpn.app',
  APPLE_APP_ID: '6792741863',
};

const GOOGLE: NodeJS.ProcessEnv = {
  ...BASE,
  GOOGLE_PACKAGE_NAME: 'com.cumulusvpn.app',
  GOOGLE_SERVICE_ACCOUNT_JSON: '{"type":"service_account"}',
  GOOGLE_RTDN_AUDIENCE: 'https://pay.cumulusvpn.com/v1/google/rtdn',
  GOOGLE_RTDN_EMAIL: 'rtdn@example.iam.gserviceaccount.com',
};

describe('config: rail activation', () => {
  it('activates a rail on its lead variable alone', () => {
    expect(loadConfig(APPLE).apple?.bundleId).toBe('com.cumulusvpn.app');
    expect(loadConfig(APPLE).google).toBeUndefined();
    expect(loadConfig(GOOGLE).google?.packageName).toBe('com.cumulusvpn.app');
    expect(loadConfig(GOOGLE).apple).toBeUndefined();
  });

  it('refuses to boot with no rail at all', () => {
    expect(() => loadConfig(BASE)).toThrow();
  });
});

describe('config: APPLE_APP_ID', () => {
  it('is required for Production — the verifier cannot check payloads without it', () => {
    const { APPLE_APP_ID: _omitted, ...noAppId } = APPLE;
    expect(() => loadConfig(noAppId)).toThrow(/APPLE_APP_ID is required/);
  });

  it('is optional for Sandbox', () => {
    const { APPLE_APP_ID: _omitted, ...noAppId } = APPLE;
    const cfg = loadConfig({ ...noAppId, APPLE_ENVIRONMENT: 'Sandbox' });
    expect(cfg.apple?.appAppleId).toBeUndefined();
  });

  it('rejects a non-numeric id rather than passing NaN to the verifier', () => {
    expect(() => loadConfig({ ...APPLE, APPLE_APP_ID: 'id6792741863' })).toThrow(/APPLE_APP_ID/);
    expect(() => loadConfig({ ...APPLE, APPLE_APP_ID: '0' })).toThrow(/APPLE_APP_ID/);
    expect(() => loadConfig({ ...APPLE, APPLE_APP_ID: '-5' })).toThrow(/APPLE_APP_ID/);
  });

  it('parses a valid id', () => {
    expect(loadConfig(APPLE).apple?.appAppleId).toBe(6792741863);
  });
});

describe('config: bounded sandbox/test grant days', () => {
  it('defaults to 1 day so store review unlocks without a manual step', () => {
    expect(loadConfig(APPLE).apple?.sandboxGrantDays).toBe(1);
    expect(loadConfig(GOOGLE).google?.testGrantDays).toBe(1);
  });

  it('accepts 0 to restore the old grant-nothing behaviour', () => {
    expect(loadConfig({ ...APPLE, APPLE_SANDBOX_GRANT_DAYS: '0' }).apple?.sandboxGrantDays).toBe(0);
    expect(loadConfig({ ...GOOGLE, GOOGLE_TEST_GRANT_DAYS: '0' }).google?.testGrantDays).toBe(0);
  });

  it('caps the probe at 30 days — it is not a way to hand out free months', () => {
    expect(() => loadConfig({ ...APPLE, APPLE_SANDBOX_GRANT_DAYS: '31' })).toThrow(/0\.\.30/);
    expect(() => loadConfig({ ...GOOGLE, GOOGLE_TEST_GRANT_DAYS: '360' })).toThrow(/0\.\.30/);
  });

  it('rejects junk rather than silently falling back', () => {
    expect(() => loadConfig({ ...APPLE, APPLE_SANDBOX_GRANT_DAYS: 'yes' })).toThrow();
    expect(() => loadConfig({ ...APPLE, APPLE_SANDBOX_GRANT_DAYS: '1.5' })).toThrow();
  });

  it('leaves the full-grant switches off by default', () => {
    expect(loadConfig(APPLE).apple?.sandboxGrants).toBe(false);
    expect(loadConfig(GOOGLE).google?.testGrants).toBe(false);
  });
});
