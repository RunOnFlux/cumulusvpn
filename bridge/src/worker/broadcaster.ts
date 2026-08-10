/**
 * The broadcaster drains the pending-payment queue: one payment -> one FLUX
 * tx. It is the ONLY writer that spends treasury UTXOs, and it processes one
 * payment per tick, so spends are fully serialized — combined with the
 * spent-outpoint ledger (which lets us chain our own 0-conf change), two
 * renewals seconds apart can never double-spend.
 *
 * Failure posture: rows never leave `pending` on error — a fiat-paid user
 * must eventually get their months. Insufficient funds parks the row with
 * backoff and pages the operator to top the treasury up.
 */
import type { FastifyBaseLogger } from 'fastify';

import type { ChainClient } from '../flux/chain.js';
import { InsufficientFundsError, selectUtxos } from '../flux/utxo.js';
import { buildPaymentTx, type TreasuryKey } from '../flux/tx.js';
import { memoForCode } from '../codes.js';
import type { PaymentsRepo } from '../db/payments.js';
import type { Alerter } from './alerts.js';
import { startLoop, type LoopHandle } from './loop.js';

const TICK_MS = 5_000;

export interface BroadcasterDeps {
  readonly chain: ChainClient;
  readonly payments: PaymentsRepo;
  readonly key: TreasuryKey;
  readonly paymentAddress: string;
  readonly feeZats: number;
  readonly alerter: Alerter;
  readonly log: FastifyBaseLogger;
}

export function startBroadcaster(d: BroadcasterDeps): LoopHandle {
  return startLoop('broadcaster', TICK_MS, d.log, async () => {
    const row = d.payments.nextPending();
    if (!row) {
      return;
    }
    try {
      const [tip, utxos] = await Promise.all([d.chain.tipHeight(), d.chain.utxos(d.key.address)]);
      const excluded = d.payments.spentOutpoints();
      const needed = row.flux_zats + d.feeZats;
      const sel = selectUtxos(utxos, excluded, needed);
      const built = buildPaymentTx({
        key: d.key,
        inputs: sel.inputs,
        inputTotalZats: sel.totalZats,
        paymentAddress: d.paymentAddress,
        amountZats: row.flux_zats,
        memo: memoForCode(row.payment_code),
        feeZats: d.feeZats,
        tipHeight: tip,
      });
      // WRITE-AHEAD: persist the exact bytes + held outpoints BEFORE the tx
      // leaves the process. If we crash or the broadcast response is lost
      // after the network accepted it, the row is already `broadcast` with
      // its inputs held — the confirmer re-broadcasts the SAME bytes (same
      // txid, idempotent) instead of a fresh build double-paying the user.
      d.payments.markBroadcast(row.id, built.txid, built.hex, built.expiryHeight, built.spent);
      try {
        await d.chain.broadcast(built.hex);
        d.log.info(
          { payment: row.id, rail: row.rail, months: row.months, txid: built.txid },
          'broadcast payment tx',
        );
      } catch (e) {
        // The tx MAY have been accepted despite the error (lost response,
        // "already in mempool" from the fallback). Do NOT reset to pending —
        // the confirmer re-broadcasts the persisted bytes until the tx
        // appears or definitively expires.
        d.log.warn(
          { err: e, payment: row.id, txid: built.txid },
          'broadcast attempt errored; confirmer will re-broadcast the persisted tx',
        );
      }
    } catch (e) {
      // Pre-broadcast failures only (chain reads, selection, build): nothing
      // has been committed or sent, so parking the row for retry is safe.
      d.payments.recordFailure(row.id, row.attempts, e instanceof Error ? e.message : String(e));
      if (e instanceof InsufficientFundsError) {
        await d.alerter.alert(
          'treasury-empty',
          `treasury cannot fund payment #${row.id} (${row.flux_zats / 1e8} FLUX needed): ${e.message}`,
        );
      } else {
        d.log.error({ err: e, payment: row.id }, 'broadcast attempt failed');
      }
    }
  });
}
