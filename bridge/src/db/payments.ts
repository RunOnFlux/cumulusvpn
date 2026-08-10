/** Typed repository over the `payments` + `spent_outpoints` tables. */
import type { Db } from './db.js';

export type Rail = 'stripe' | 'apple' | 'google';
export type PaymentStatus = 'pending' | 'broadcast' | 'confirmed' | 'failed';

export interface PaymentRow {
  readonly id: number;
  readonly rail: Rail;
  readonly event_key: string;
  readonly external_ref: string;
  readonly payment_code: string;
  readonly months: number;
  readonly flux_zats: number;
  readonly status: PaymentStatus;
  readonly txid: string | null;
  readonly raw_hex: string | null;
  readonly expiry_height: number | null;
  readonly attempts: number;
  readonly next_retry_at: number;
  readonly last_error: string | null;
  readonly created_at: number;
  readonly broadcast_at: number | null;
  readonly confirmed_at: number | null;
}

export interface NewPayment {
  readonly rail: Rail;
  readonly eventKey: string;
  readonly externalRef: string;
  readonly paymentCode: string;
  readonly months: number;
  readonly fluxZats: number;
}

const now = (): number => Math.floor(Date.now() / 1000);

export class PaymentsRepo {
  constructor(private readonly db: Db) {}

  /**
   * Idempotent insert: returns the new row id, or null when this
   * (rail, event_key) was already recorded — the caller must treat null as
   * "duplicate delivery, ack and move on".
   */
  insertIdempotent(p: NewPayment): number | null {
    const r = this.db
      .prepare(
        `INSERT INTO payments (rail, event_key, external_ref, payment_code, months, flux_zats, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (rail, event_key) DO NOTHING`,
      )
      .run(p.rail, p.eventKey, p.externalRef, p.paymentCode, p.months, p.fluxZats, now());
    return r.changes === 1 ? Number(r.lastInsertRowid) : null;
  }

  /** The oldest pending payment whose retry time has come, if any. */
  nextPending(): PaymentRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM payments WHERE status = 'pending' AND next_retry_at <= ? ORDER BY id LIMIT 1`,
      )
      .get(now()) as PaymentRow | undefined;
  }

  /** All broadcast-but-unconfirmed payments, for the confirmer. */
  allBroadcast(): PaymentRow[] {
    return this.db
      .prepare(`SELECT * FROM payments WHERE status = 'broadcast' ORDER BY id`)
      .all() as PaymentRow[];
  }

  /**
   * Write-ahead commit of an intended spend: tx bytes + held outpoints are
   * durable BEFORE the tx first leaves the process, so a crash or lost
   * broadcast response can only ever delay this payment — never rebuild it
   * onto different inputs (which would double-pay once both txs mine).
   */
  markBroadcast(
    id: number,
    txid: string,
    rawHex: string,
    expiryHeight: number,
    spentOutpoints: readonly { txid: string; vout: number }[],
  ): void {
    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE payments SET status = 'broadcast', txid = ?, raw_hex = ?, expiry_height = ?, broadcast_at = ?, last_error = NULL WHERE id = ?`,
        )
        .run(txid, rawHex, expiryHeight, now(), id);
      const ins = this.db.prepare(
        `INSERT OR IGNORE INTO spent_outpoints (txid, vout, spent_by, created_at) VALUES (?, ?, ?, ?)`,
      );
      for (const o of spentOutpoints) {
        ins.run(o.txid, o.vout, txid, now());
      }
    })();
  }

  markConfirmed(id: number): void {
    this.db.transaction(() => {
      const row = this.db.prepare(`SELECT txid FROM payments WHERE id = ?`).get(id) as
        { txid: string | null } | undefined;
      this.db
        .prepare(
          `UPDATE payments SET status = 'confirmed', raw_hex = NULL, confirmed_at = ? WHERE id = ?`,
        )
        .run(now(), id);
      // The inputs are provably consumed on-chain; utxos() no longer returns
      // them, so the ledger rows have done their job — prune to keep the
      // table bounded.
      if (row?.txid) {
        this.db.prepare(`DELETE FROM spent_outpoints WHERE spent_by = ?`).run(row.txid);
      }
    })();
  }

  /**
   * A broadcast tx DEFINITIVELY expired unmined (positive not-found from a
   * healthy chain source, well past nExpiryHeight): forget its txid + bytes,
   * release the outpoints it held, and requeue for a fresh build. Never call
   * this off an errored lookup — see ChainClient.tx().
   */
  resetExpired(id: number, staleTxid: string): void {
    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE payments SET status = 'pending', txid = NULL, raw_hex = NULL, expiry_height = NULL, broadcast_at = NULL,
           next_retry_at = 0, last_error = 'tx expired unmined' WHERE id = ?`,
        )
        .run(id);
      this.db.prepare(`DELETE FROM spent_outpoints WHERE spent_by = ?`).run(staleTxid);
    })();
  }

  /** Record a failed broadcast attempt with exponential backoff (1 min -> 6 h cap). */
  recordFailure(id: number, attempts: number, error: string): void {
    const delay = Math.min(60 * 2 ** attempts, 6 * 3600);
    this.db
      .prepare(`UPDATE payments SET attempts = ?, next_retry_at = ?, last_error = ? WHERE id = ?`)
      .run(attempts + 1, now() + delay, error.slice(0, 500), id);
  }

  /** Recent payments for a code — the client-facing status feed. */
  byCode(code: string, limit = 10): PaymentRow[] {
    return this.db
      .prepare(
        `SELECT * FROM payments WHERE payment_code = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
      )
      .all(code, limit) as PaymentRow[];
  }

  /** Outpoints our own in-flight (pending/broadcast) txs already consume. */
  spentOutpoints(): Set<string> {
    const rows = this.db.prepare(`SELECT txid, vout FROM spent_outpoints`).all() as {
      txid: string;
      vout: number;
    }[];
    return new Set(rows.map((r) => `${r.txid}:${r.vout}`));
  }

  /** Queue metrics for /v1/health and /internal/treasury. */
  queueStats(): {
    pending: number;
    broadcast: number;
    pendingZats: number;
    oldestUnsettledAge: number | null;
  } {
    const agg = this.db
      .prepare(
        `SELECT
           SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
           SUM(CASE WHEN status = 'broadcast' THEN 1 ELSE 0 END) AS broadcast,
           SUM(CASE WHEN status = 'pending' THEN flux_zats ELSE 0 END) AS pending_zats,
           MIN(CASE WHEN status IN ('pending','broadcast') THEN created_at ELSE NULL END) AS oldest_unsettled
         FROM payments`,
      )
      .get() as {
      pending: number | null;
      broadcast: number | null;
      pending_zats: number | null;
      oldest_unsettled: number | null;
    };
    return {
      pending: agg.pending ?? 0,
      broadcast: agg.broadcast ?? 0,
      pendingZats: agg.pending_zats ?? 0,
      // Age of the oldest UNCONFIRMED payment by created_at — created_at is
      // stable across broadcast->reset->pending cycles, so a grant churning
      // between states for hours cannot dodge the stuck-queue alert by
      // spending only seconds at a time in `pending`.
      oldestUnsettledAge: agg.oldest_unsettled === null ? null : now() - agg.oldest_unsettled,
    };
  }
}
