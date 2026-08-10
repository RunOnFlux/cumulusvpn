/**
 * The confirmer walks broadcast payments to their terminal state:
 *
 *   - >= 1 confirmation (the gateways' own entitlement threshold) -> confirmed
 *   - chain doesn't know the tx yet -> re-broadcast the PERSISTED bytes
 *     (same txid, idempotent — heals crashes and lost broadcast responses)
 *   - chain DEFINITIVELY doesn't know it well past nExpiryHeight -> reset
 *     for a fresh build
 *
 * The reset decision only ever follows a POSITIVE not-found from a healthy
 * chain source: `ChainClient.tx()` throws on transport errors, and an
 * errored lookup skips the row. Treating "explorer down" as "tx vanished"
 * would rebuild a payment whose tx actually mined — a double-pay.
 */
import type { FastifyBaseLogger } from 'fastify';

import type { ChainClient } from '../flux/chain.js';
import type { PaymentsRepo } from '../db/payments.js';
import { startLoop, type LoopHandle } from './loop.js';

const TICK_MS = 20_000;

/**
 * Blocks past nExpiryHeight before a positively-absent tx is declared dead
 * (~10 min at 30 s blocks) — generous slack for explorer indexing lag.
 */
const EXPIRY_SLACK = 20;

export function startConfirmer(
  chain: ChainClient,
  payments: PaymentsRepo,
  log: FastifyBaseLogger,
): LoopHandle {
  return startLoop('confirmer', TICK_MS, log, async () => {
    const rows = payments.allBroadcast();
    if (rows.length === 0) {
      return;
    }
    const tip = await chain.tipHeight();
    for (const row of rows) {
      if (!row.txid) {
        continue;
      }
      let info;
      try {
        info = await chain.tx(row.txid);
      } catch (e) {
        // Transport error — no decision can be made for this row this tick.
        log.warn({ err: e, payment: row.id, txid: row.txid }, 'tx lookup failed; will retry');
        continue;
      }
      if (info !== 'not-found' && info.confirmations >= 1) {
        payments.markConfirmed(row.id);
        log.info({ payment: row.id, txid: row.txid }, 'payment confirmed on chain');
      } else if (info === 'not-found') {
        if (row.expiry_height !== null && tip > row.expiry_height + EXPIRY_SLACK) {
          log.warn(
            { payment: row.id, txid: row.txid },
            'tx definitively expired unmined; resetting for rebuild',
          );
          payments.resetExpired(row.id, row.txid);
        } else if (row.raw_hex) {
          // Not expired yet and the chain doesn't know it: push the exact
          // persisted bytes again. Same txid — a duplicate submission is
          // rejected by the mempool, never double-paid.
          try {
            await chain.broadcast(row.raw_hex);
            log.info({ payment: row.id, txid: row.txid }, 're-broadcast persisted tx');
          } catch (e) {
            log.warn(
              { err: e, payment: row.id, txid: row.txid },
              're-broadcast attempt failed; will retry',
            );
          }
        }
      }
      // 0-conf mempool sighting: nothing to do, next tick checks again.
    }
  });
}
