/**
 * Env-driven configuration, validated fail-fast at boot.
 *
 * Rails are opt-in by env presence so the service can launch Stripe-only and
 * grow Apple/Google later without code changes. The treasury WIF is decoded
 * once here and the raw value is never logged or re-exported anywhere —
 * keep it that way.
 */

export interface StripeConfig {
  readonly secretKey: string;
  readonly webhookSecret: string;
  readonly priceMonthly: string;
  readonly priceAnnual: string;
  readonly successUrl: string;
  readonly cancelUrl: string;
  /** Where Stripe's billing portal sends the customer back to. */
  readonly portalReturnUrl: string;
  /**
   * Whether TEST-mode Stripe invoices settle REAL chain payments. Default
   * false, mirroring APPLE_SANDBOX_GRANTS / GOOGLE_TEST_GRANTS: a test
   * checkout is verified and bound like any other, it just does not spend the
   * treasury. Without this, running the bridge against sk_test_ and clicking
   * through a 4242 checkout broadcasts a real 20-FLUX tx every time.
   */
  readonly testGrants: boolean;
}

export interface AppleConfig {
  readonly bundleId: string;
  readonly appAppleId: number | undefined;
  readonly environment: 'Production' | 'Sandbox';
  /** Also accept sandbox-signed payloads (TestFlight/review) in production. */
  readonly allowSandbox: boolean;
  /**
   * Whether sandbox-verified purchases enqueue REAL chain payments. Default
   * false: the sandbox clock renews subscriptions every few minutes and
   * would drain the treasury. Sandbox events are verified and acked, just
   * not settled on chain.
   */
  readonly sandboxGrants: boolean;
  /**
   * Days granted for a sandbox purchase when `sandboxGrants` is off. App
   * Review buys in the sandbox and app-review.md promises the reviewer that
   * premium activates within a minute, so granting nothing there is a
   * scripted rejection. Keyed by originalTransactionId, so a whole test
   * subscription — every renewal, every restore — settles AT MOST once.
   * 0 disables it entirely.
   */
  readonly sandboxGrantDays: number;
  readonly rootCaDir: string;
  readonly productMonthly: string;
  readonly productAnnual: string;
}

export interface GoogleConfig {
  readonly packageName: string;
  /** Service-account JSON, inline. Parsed, never logged. */
  readonly serviceAccountJson: string;
  /** Expected `aud` of the Pub/Sub push OIDC token. */
  readonly rtdnAudience: string;
  /** Expected service-account email in the OIDC token. */
  readonly rtdnEmail: string;
  readonly basePlanMonthly: string;
  readonly basePlanAnnual: string;
  /** Whether license-tester (test) purchases enqueue real chain payments. */
  readonly testGrants: boolean;
  /**
   * Days granted for a license-tester purchase when `testGrants` is off —
   * the Play twin of AppleConfig.sandboxGrantDays. Keyed by purchaseToken,
   * which is stable across renewals, so a tester's subscription settles AT
   * MOST once. 0 disables it entirely.
   */
  readonly testGrantDays: number;
}

export interface Config {
  readonly port: number;
  readonly host: string;
  readonly dbPath: string;
  readonly paymentAddress: string;
  readonly priceFlux: number;
  readonly priceZats: number;
  readonly feeZats: number;
  readonly treasuryWif: string;
  readonly explorerUrl: string;
  readonly explorerFallbackUrl: string;
  readonly adminToken: string;
  readonly alertWebhookUrl: string | undefined;
  readonly minTreasuryFlux: number;
  /**
   * Whether day-granular (non-30-multiple) voucher grants may be CREATED.
   * Keep false until the whole gateway fleet runs the pro-rata day rule —
   * old gateways ignore sub-price payments, so a day voucher settled early
   * would grant nothing on them. 30-multiple vouchers are always allowed
   * (they settle as whole price multiples, which every gateway honors).
   */
  readonly dayGrantsEnabled: boolean;
  readonly stripe: StripeConfig | undefined;
  readonly apple: AppleConfig | undefined;
  readonly google: GoogleConfig | undefined;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key];
  if (!v) {
    throw new Error(`config: ${key} is required`);
  }
  return v;
}

function num(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const v = env[key];
  if (v === undefined || v === '') {
    return fallback;
  }
  const n = Number(v);
  if (!Number.isFinite(n)) {
    throw new Error(`config: ${key} must be a number, got ${JSON.stringify(v)}`);
  }
  return n;
}

function loadStripe(env: NodeJS.ProcessEnv): StripeConfig | undefined {
  if (!env.STRIPE_SECRET_KEY) {
    return undefined;
  }
  const successUrl = required(env, 'STRIPE_SUCCESS_URL');
  // The web client's return flow REQUIRES the session id inside the hash
  // query (`#/upgrade?session={CHECKOUT_SESSION_ID}`) — without it the
  // return renders as a plain visit: no activation panel, and a desktop
  // code override would be wiped. Fail fast rather than ship a silent UX
  // break.
  if (!successUrl.includes('{CHECKOUT_SESSION_ID}')) {
    throw new Error(
      'config: STRIPE_SUCCESS_URL must contain the {CHECKOUT_SESSION_ID} placeholder',
    );
  }
  const cancelUrl = required(env, 'STRIPE_CANCEL_URL');
  return {
    secretKey: required(env, 'STRIPE_SECRET_KEY'),
    webhookSecret: required(env, 'STRIPE_WEBHOOK_SECRET'),
    priceMonthly: required(env, 'STRIPE_PRICE_MONTHLY'),
    priceAnnual: required(env, 'STRIPE_PRICE_ANNUAL'),
    successUrl,
    cancelUrl,
    // Optional so existing deployments keep booting; the cancel URL is a sane
    // landing spot (it already routes to #/upgrade without claiming a purchase
    // just happened).
    portalReturnUrl: env.STRIPE_PORTAL_RETURN_URL || cancelUrl,
    testGrants: env.STRIPE_TEST_GRANTS === 'true',
  };
}

function loadApple(env: NodeJS.ProcessEnv): AppleConfig | undefined {
  if (!env.APPLE_BUNDLE_ID) {
    return undefined;
  }
  const environment = env.APPLE_ENVIRONMENT ?? 'Production';
  if (environment !== 'Production' && environment !== 'Sandbox') {
    throw new Error('config: APPLE_ENVIRONMENT must be Production or Sandbox');
  }
  // SignedDataVerifier requires the numeric app id to verify PRODUCTION
  // payloads and throws a library-internal error without it. Checking here
  // turns "bridge won't boot, cryptic stack trace" into one clear line.
  let appAppleId: number | undefined;
  if (env.APPLE_APP_ID !== undefined && env.APPLE_APP_ID !== '') {
    appAppleId = Number(env.APPLE_APP_ID);
    if (!Number.isInteger(appAppleId) || appAppleId <= 0) {
      throw new Error(
        `config: APPLE_APP_ID must be a positive integer (got "${env.APPLE_APP_ID}")`,
      );
    }
  }
  if (environment === 'Production' && appAppleId === undefined) {
    throw new Error(
      'config: APPLE_APP_ID is required when APPLE_ENVIRONMENT=Production ' +
        '(App Store Connect > App Information > General > Apple ID)',
    );
  }
  return {
    bundleId: required(env, 'APPLE_BUNDLE_ID'),
    appAppleId,
    environment,
    allowSandbox: env.APPLE_ALLOW_SANDBOX !== 'false',
    sandboxGrants: env.APPLE_SANDBOX_GRANTS === 'true',
    sandboxGrantDays: grantDays(env, 'APPLE_SANDBOX_GRANT_DAYS'),
    rootCaDir: env.APPLE_ROOT_CA_DIR ?? new URL('../certs', import.meta.url).pathname,
    productMonthly: env.APPLE_PRODUCT_MONTHLY ?? 'cvpn.premium.monthly',
    productAnnual: env.APPLE_PRODUCT_ANNUAL ?? 'cvpn.premium.annual',
  };
}

function loadGoogle(env: NodeJS.ProcessEnv): GoogleConfig | undefined {
  if (!env.GOOGLE_PACKAGE_NAME) {
    return undefined;
  }
  return {
    packageName: required(env, 'GOOGLE_PACKAGE_NAME'),
    serviceAccountJson: required(env, 'GOOGLE_SERVICE_ACCOUNT_JSON'),
    rtdnAudience: required(env, 'GOOGLE_RTDN_AUDIENCE'),
    rtdnEmail: required(env, 'GOOGLE_RTDN_EMAIL'),
    basePlanMonthly: env.GOOGLE_BASE_PLAN_MONTHLY ?? 'premium-monthly',
    basePlanAnnual: env.GOOGLE_BASE_PLAN_ANNUAL ?? 'premium-annual',
    testGrants: env.GOOGLE_TEST_GRANTS === 'true',
    testGrantDays: grantDays(env, 'GOOGLE_TEST_GRANT_DAYS'),
  };
}

/**
 * Days a sandbox/test purchase settles for. Default 1: one day costs
 * price/30 (0.67 FLUX at 20) and can only ever be spent once per test
 * subscription, which is a far cheaper failure than a store rejection.
 * Capped at 30 — a probe grant is not a way to hand out free months.
 */
function grantDays(env: NodeJS.ProcessEnv, key: string): number {
  const raw = env[key];
  if (raw === undefined || raw === '') {
    return 1;
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 30) {
    throw new Error(`config: ${key} must be an integer 0..30 (got "${raw}")`);
  }
  return n;
}

/** Parse and validate the whole config from process.env. Throws on any gap. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const priceFlux = num(env, 'PRICE_FLUX', 20);
  if (priceFlux <= 0) {
    throw new Error('config: PRICE_FLUX must be > 0');
  }
  const feeFlux = num(env, 'FEE_FLUX', 0.0001);
  const cfg: Config = {
    port: num(env, 'PORT', 8080),
    host: env.HOST ?? '0.0.0.0',
    dbPath: env.DB_PATH ?? '/data/bridge.db',
    paymentAddress: required(env, 'PAYMENT_ADDRESS'),
    priceFlux,
    priceZats: Math.round(priceFlux * 1e8),
    feeZats: Math.round(feeFlux * 1e8),
    treasuryWif: required(env, 'TREASURY_WIF'),
    explorerUrl: env.EXPLORER_URL ?? 'https://explorer.runonflux.io/api',
    explorerFallbackUrl: env.EXPLORER_FALLBACK_URL ?? 'https://api.runonflux.io',
    adminToken: required(env, 'ADMIN_TOKEN'),
    alertWebhookUrl: env.ALERT_WEBHOOK_URL || undefined,
    minTreasuryFlux: num(env, 'MIN_TREASURY_FLUX', 200),
    dayGrantsEnabled: env.DAY_GRANTS_ENABLED === 'true',
    stripe: loadStripe(env),
    apple: loadApple(env),
    google: loadGoogle(env),
  };
  if (!cfg.stripe && !cfg.apple && !cfg.google) {
    throw new Error(
      'config: no payment rail configured (need at least one of Stripe/Apple/Google)',
    );
  }
  return cfg;
}

/** Days granted per plan — annual settles as one 360-day chain payment. */
export const PLAN_DAYS: Record<'monthly' | 'annual', number> = { monthly: 30, annual: 360 };
