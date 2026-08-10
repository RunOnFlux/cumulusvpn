/**
 * Worker-level tests for the settlement pipeline invariants that the review
 * rounds established (do not regress):
 *
 *  - WRITE-AHEAD: the spend is durable BEFORE the tx leaves the process; a
 *    failed/lost broadcast leaves the row in `broadcast` (never a fresh
 *    rebuild) for the confirmer to re-push the same bytes.
 *  - The confirmer only resets on a POSITIVE not-found past expiry; thrown
 *    (transport) lookups change nothing.
 */
import { describe, expect, it } from 'vitest';
import { base58 } from '@scure/base';
import type { FastifyBaseLogger } from 'fastify';

import { openDb } from '../src/db/db.js';
import { PaymentsRepo } from '../src/db/payments.js';
import type { ChainClient, TxInfo, Utxo } from '../src/flux/chain.js';
import { treasuryKeyFromWif } from '../src/flux/tx.js';
import { Alerter } from '../src/worker/alerts.js';
import { startBroadcaster } from '../src/worker/broadcaster.js';
import { startConfirmer } from '../src/worker/confirmer.js';

const CODE = base58.encode(new Uint8Array(20).fill(7));
const WIF = 'KwTNVQ9B4wXUfnTF6e1EQkTHJwbzeFGYyK7NdopxuJjQYvQkAxtA';
const PAYMENT_ADDRESS = 't3disq3aZz8K3RLZL9zfkpP2UWNVV3hq4vZ';

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

interface FakeChain extends ChainClient {
  broadcastCalls: string[];
}

function fakeChain(over: {
  tip?: number;
  utxos?: Utxo[];
  broadcast?: (hex: string) => Promise<string>;
  tx?: () => Promise<TxInfo | 'not-found'>;
}): FakeChain {
  const broadcastCalls: string[] = [];
  return {
    broadcastCalls,
    tipHeight: async () => over.tip ?? 1000,
    utxos: async () => over.utxos ?? [],
    tx: over.tx ?? (async () => 'not-found' as const),
    broadcast: async (hex: string) => {
      broadcastCalls.push(hex);
      if (over.broadcast) {
        return over.broadcast(hex);
      }
      return 'accepted-txid';
    },
    balanceZats: async () => 0,
  } as FakeChain;
}

function setup() {
  const payments = new PaymentsRepo(openDb(':memory:'));
  payments.insertIdempotent({
    rail: 'stripe',
    eventKey: 'in_w1',
    externalRef: 'sub',
    paymentCode: CODE,
    days: 30,
    fluxZats: 20e8,
  });
  const key = treasuryKeyFromWif(WIF);
  const alerter = new Alerter(undefined, nullLog);
  return { payments, key, alerter };
}

const RICH_UTXO: Utxo = { txid: 'ab'.repeat(32), vout: 0, satoshis: 30e8, confirmations: 3 };

const oneTick = async (start: () => { stop(): void }, waitMs = 150): Promise<void> => {
  const handle = start();
  await new Promise<void>((r) => setTimeout(() => r(), waitMs));
  handle.stop();
};

describe('broadcaster write-ahead', () => {
  it('persists txid + raw_hex + outpoints, then broadcasts those exact bytes', async () => {
    const { payments, key, alerter } = setup();
    const chain = fakeChain({ utxos: [RICH_UTXO] });
    await oneTick(() =>
      startBroadcaster({
        chain,
        payments,
        key,
        paymentAddress: PAYMENT_ADDRESS,
        feeZats: 10_000,
        alerter,
        log: nullLog,
      }),
    );
    const row = payments.allBroadcast()[0]!;
    expect(row.status).toBe('broadcast');
    expect(row.raw_hex).toBeTruthy();
    expect(row.txid).toBeTruthy();
    expect(chain.broadcastCalls).toEqual([row.raw_hex]);
    expect(payments.spentOutpoints().has(`${RICH_UTXO.txid}:0`)).toBe(true);
  });

  it('a FAILED broadcast still leaves the row broadcast with its spend held (no rebuild)', async () => {
    const { payments, key, alerter } = setup();
    const chain = fakeChain({
      utxos: [RICH_UTXO],
      broadcast: async () => {
        throw new Error('network sneeze — tx may or may not have landed');
      },
    });
    await oneTick(() =>
      startBroadcaster({
        chain,
        payments,
        key,
        paymentAddress: PAYMENT_ADDRESS,
        feeZats: 10_000,
        alerter,
        log: nullLog,
      }),
    );
    const row = payments.allBroadcast()[0]!;
    // The load-bearing assertion: NOT reset to pending — a rebuild onto other
    // inputs is what double-pays when the original tx actually landed.
    expect(row.status).toBe('broadcast');
    expect(row.raw_hex).toBeTruthy();
    expect(payments.nextPending()).toBeUndefined();
    expect(payments.spentOutpoints().size).toBe(1);
  });

  it('insufficient funds parks the row pending with backoff, nothing sent', async () => {
    const { payments, key, alerter } = setup();
    const chain = fakeChain({ utxos: [] });
    await oneTick(() =>
      startBroadcaster({
        chain,
        payments,
        key,
        paymentAddress: PAYMENT_ADDRESS,
        feeZats: 10_000,
        alerter,
        log: nullLog,
      }),
    );
    expect(chain.broadcastCalls).toHaveLength(0);
    expect(payments.allBroadcast()).toHaveLength(0);
    expect(payments.queueStats().pending).toBe(1);
    // Backed off, not immediately re-eligible.
    expect(payments.nextPending()).toBeUndefined();
  });
});

describe('confirmer decisions', () => {
  function broadcastRow(payments: PaymentsRepo, expiry: number): number {
    const row = payments.nextPending()!;
    payments.markBroadcast(row.id, 'txid-under-test', 'feedface', expiry, [{ txid: 'p', vout: 0 }]);
    return row.id;
  }

  it('confirms at >= 1 confirmation', async () => {
    const { payments } = setup();
    const id = broadcastRow(payments, 2000);
    const chain = fakeChain({ tx: async () => ({ confirmations: 2 }) });
    await oneTick(() => startConfirmer(chain, payments, nullLog));
    expect(payments.byCode(CODE)[0]!.status).toBe('confirmed');
    expect(payments.byCode(CODE)[0]!.id).toBe(id);
  });

  it('a THROWN (transport) lookup changes nothing — no reset, no re-broadcast', async () => {
    const { payments } = setup();
    broadcastRow(payments, 0); // long past expiry — must STILL not reset
    const chain = fakeChain({
      tip: 5000,
      tx: async () => {
        throw new Error('explorer down');
      },
    });
    await oneTick(() => startConfirmer(chain, payments, nullLog));
    const row = payments.allBroadcast()[0]!;
    expect(row.status).toBe('broadcast');
    expect(chain.broadcastCalls).toHaveLength(0);
    expect(payments.spentOutpoints().size).toBe(1);
  });

  it('definitive not-found BEFORE expiry re-broadcasts the persisted bytes', async () => {
    const { payments } = setup();
    broadcastRow(payments, 2000); // tip 1000 < expiry
    const chain = fakeChain({ tip: 1000, tx: async () => 'not-found' as const });
    await oneTick(() => startConfirmer(chain, payments, nullLog));
    expect(chain.broadcastCalls).toEqual(['feedface']);
    expect(payments.allBroadcast()[0]!.status).toBe('broadcast');
  });

  it('definitive not-found PAST expiry+slack resets for a fresh build', async () => {
    const { payments } = setup();
    broadcastRow(payments, 100); // tip 1000 >> expiry 100 + slack 20
    const chain = fakeChain({ tip: 1000, tx: async () => 'not-found' as const });
    await oneTick(() => startConfirmer(chain, payments, nullLog));
    const requeued = payments.nextPending();
    expect(requeued).toBeDefined();
    expect(requeued!.txid).toBeNull();
    expect(requeued!.raw_hex).toBeNull();
    expect(payments.spentOutpoints().size).toBe(0);
  });

  it('0-conf mempool sighting (confirmations 0) waits — no reset, no re-broadcast', async () => {
    const { payments } = setup();
    broadcastRow(payments, 100); // even past expiry: the tx IS known to the chain
    const chain = fakeChain({ tip: 1000, tx: async () => ({ confirmations: 0 }) });
    await oneTick(() => startConfirmer(chain, payments, nullLog));
    expect(payments.allBroadcast()[0]!.status).toBe('broadcast');
    expect(chain.broadcastCalls).toHaveLength(0);
  });
});
