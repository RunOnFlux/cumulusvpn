/**
 * Embedded, versioned schema migrations. Never edit a shipped entry —
 * append a new one. Index in this array + 1 == PRAGMA user_version after
 * that migration has run.
 */
export const MIGRATIONS: readonly string[] = [
  `
  -- One row per *chain grant we owe*: a verified fiat payment event that must
  -- become exactly one FLUX tx. UNIQUE(rail, event_key) is the double-pay
  -- guard: webhook retries / RTDN redeliveries / ASN replays collapse here.
  CREATE TABLE payments (
    id            INTEGER PRIMARY KEY,
    rail          TEXT NOT NULL CHECK (rail IN ('stripe','apple','google')),
    event_key     TEXT NOT NULL,
    external_ref  TEXT NOT NULL,
    payment_code  TEXT NOT NULL,
    months        INTEGER NOT NULL CHECK (months >= 1),
    flux_zats     INTEGER NOT NULL CHECK (flux_zats > 0),
    status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','broadcast','confirmed','failed')),
    txid          TEXT,
    -- The signed tx bytes, persisted BEFORE first network broadcast (write-
    -- ahead): after a crash or lost response the confirmer re-broadcasts
    -- these exact bytes (same txid, idempotent) instead of building a fresh
    -- tx that would double-pay.
    raw_hex       TEXT,
    expiry_height INTEGER,
    attempts      INTEGER NOT NULL DEFAULT 0,
    next_retry_at INTEGER NOT NULL DEFAULT 0,
    last_error    TEXT,
    created_at    INTEGER NOT NULL,
    broadcast_at  INTEGER,
    confirmed_at  INTEGER,
    UNIQUE (rail, event_key)
  );
  CREATE INDEX payments_status ON payments (status, next_retry_at);
  CREATE INDEX payments_code ON payments (payment_code, created_at DESC);

  -- One row per store subscription, so renewals can be mapped back to a code
  -- even when the notification payload lacks the account field.
  CREATE TABLE subscriptions (
    rail          TEXT NOT NULL CHECK (rail IN ('stripe','apple','google')),
    external_id   TEXT NOT NULL,
    payment_code  TEXT NOT NULL,
    plan          TEXT NOT NULL CHECK (plan IN ('monthly','annual')),
    status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','canceled','refunded','on_hold')),
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    PRIMARY KEY (rail, external_id)
  );

  -- appAccountToken -> code. The UUID is a one-way hash of the code, so the
  -- reverse mapping must be persisted at first /v1/apple/verify.
  CREATE TABLE apple_token_map (
    app_account_token TEXT PRIMARY KEY,
    payment_code      TEXT NOT NULL
  );

  -- Treasury outpoints consumed by our own (possibly unconfirmed) txs, so
  -- back-to-back broadcasts never double-spend. Rows die with their spender:
  -- confirmed -> permanent history is on chain, expired -> deleted on reset.
  CREATE TABLE spent_outpoints (
    txid       TEXT NOT NULL,
    vout       INTEGER NOT NULL,
    spent_by   TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (txid, vout)
  );
  CREATE INDEX spent_outpoints_spender ON spent_outpoints (spent_by);
  `,
  `
  -- Migration 2: vouchers + day-granular grants.
  --
  -- (a) Rebuild payments: admit the 'voucher' rail (SQLite cannot ALTER a
  --     CHECK) and rename months -> days (the gateway entitlement rule is
  --     now pro-rata by the day; a month is days=30). Rebuild FIRST so the
  --     redemptions FK below targets the final table.
  CREATE TABLE payments_new (
    id            INTEGER PRIMARY KEY,
    rail          TEXT NOT NULL CHECK (rail IN ('stripe','apple','google','voucher')),
    event_key     TEXT NOT NULL,
    external_ref  TEXT NOT NULL,
    payment_code  TEXT NOT NULL,
    days          INTEGER NOT NULL CHECK (days >= 1),
    flux_zats     INTEGER NOT NULL CHECK (flux_zats > 0),
    status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','broadcast','confirmed','failed')),
    txid          TEXT,
    raw_hex       TEXT,
    expiry_height INTEGER,
    attempts      INTEGER NOT NULL DEFAULT 0,
    next_retry_at INTEGER NOT NULL DEFAULT 0,
    last_error    TEXT,
    created_at    INTEGER NOT NULL,
    broadcast_at  INTEGER,
    confirmed_at  INTEGER,
    UNIQUE (rail, event_key)
  );
  INSERT INTO payments_new (id, rail, event_key, external_ref, payment_code, days,
      flux_zats, status, txid, raw_hex, expiry_height, attempts, next_retry_at,
      last_error, created_at, broadcast_at, confirmed_at)
    SELECT id, rail, event_key, external_ref, payment_code, months * 30,
      flux_zats, status, txid, raw_hex, expiry_height, attempts, next_retry_at,
      last_error, created_at, broadcast_at, confirmed_at
    FROM payments;
  DROP TABLE payments;
  ALTER TABLE payments_new RENAME TO payments;
  CREATE INDEX payments_status ON payments (status, next_retry_at);
  CREATE INDEX payments_code ON payments (payment_code, created_at DESC);

  -- (b) One row per redeemable code. code is canonical: uppercase, separators
  --     stripped. type 'grant_days' mints treasury FLUX on redemption;
  --     'stripe_discount' maps to a Stripe promotion code (value = percent off).
  CREATE TABLE vouchers (
    id               INTEGER PRIMARY KEY,
    code             TEXT NOT NULL UNIQUE,
    type             TEXT NOT NULL CHECK (type IN ('grant_days','stripe_discount')),
    value            INTEGER NOT NULL CHECK (value >= 1),
    campaign         TEXT NOT NULL DEFAULT '',
    max_redemptions  INTEGER NOT NULL DEFAULT 1 CHECK (max_redemptions >= 1),
    redemption_count INTEGER NOT NULL DEFAULT 0,
    per_code_limit   INTEGER NOT NULL DEFAULT 1,
    expires_at       INTEGER,
    status           TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','revoked')),
    stripe_coupon_id TEXT,
    stripe_promo_id  TEXT,
    created_at       INTEGER NOT NULL
  );
  CREATE INDEX vouchers_campaign ON vouchers (campaign, created_at DESC);

  -- (c) UNIQUE(voucher_id, payment_code) is the double-redeem wall; the
  --     payments queue's UNIQUE(rail, event_key='<voucher_id>:<code>') mirrors
  --     it so money can only ever move once per (voucher, device).
  CREATE TABLE voucher_redemptions (
    id           INTEGER PRIMARY KEY,
    voucher_id   INTEGER NOT NULL REFERENCES vouchers(id),
    payment_code TEXT NOT NULL,
    payment_id   INTEGER REFERENCES payments(id),
    redeemed_at  INTEGER NOT NULL,
    UNIQUE (voucher_id, payment_code)
  );
  CREATE INDEX voucher_redemptions_code ON voucher_redemptions (payment_code);
  `,
  `
  -- Migration 3: remember the Stripe Customer behind a subscription.
  --
  -- Subscription-mode Checkout always creates one, but we never stored it, so
  -- there was no way to open a billing portal (cancel / change card / change
  -- plan) or to answer "which subscription belongs to this code?" in support.
  -- Nullable and backfilled lazily: any existing row picks the id up on its
  -- next invoice.paid.
  ALTER TABLE subscriptions ADD COLUMN stripe_customer_id TEXT;
  CREATE INDEX subscriptions_code ON subscriptions (payment_code, updated_at DESC);
  `,
];
