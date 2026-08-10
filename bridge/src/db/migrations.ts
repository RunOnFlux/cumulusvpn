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
];
