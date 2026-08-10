import { describe, expect, it } from 'vitest';
import utxolib from '@runonflux/utxo-lib';

import { buildPaymentTx, treasuryKeyFromWif, FLUX_NETWORK, EXPIRY_DELTA } from '../src/flux/tx.js';
import { selectUtxos, InsufficientFundsError } from '../src/flux/utxo.js';

/** Fixture key: privkey = 32 x 0x07 (compressed WIF). Address t1YoaBBF… */
const WIF = 'KwTNVQ9B4wXUfnTF6e1EQkTHJwbzeFGYyK7NdopxuJjQYvQkAxtA';
const PAYMENT_ADDRESS = 't3disq3aZz8K3RLZL9zfkpP2UWNVV3hq4vZ';
const MEMO = 'CVPN1:BS9J1c9RcXVGpNNUM3nlyLVmlDT';

describe('flux tx construction', () => {
  const key = treasuryKeyFromWif(WIF);

  it('derives the treasury address from the WIF', () => {
    expect(key.address).toBe('t1YoaBBFNJaW1aDHQa84ie4EGpF1QBtq331');
  });

  it('builds a deterministic, golden-pinned Sapling v4 tx', () => {
    const built = buildPaymentTx({
      key,
      inputs: [{ txid: '11'.repeat(32), vout: 1, satoshis: 3_000_000_000, confirmations: 5 }],
      inputTotalZats: 3_000_000_000,
      paymentAddress: PAYMENT_ADDRESS,
      amountZats: 2_000_000_000, // 20 FLUX
      memo: MEMO,
      feeZats: 10_000,
      tipHeight: 2_846_719,
    });
    // RFC 6979 signing makes the whole tx byte-deterministic.
    expect(built.txid).toBe('f9dc6d4c627e6d288d8b1a4bce7ab9f045894992889702e8e204c73caeba3375');
    // Overwintered v4 header + Sapling version group id (LE).
    expect(built.hex.startsWith('0400008085202f89')).toBe(true);
    expect(built.expiryHeight).toBe(2_846_719 + EXPIRY_DELTA);
    expect(built.spent).toEqual([{ txid: '11'.repeat(32), vout: 1 }]);
  });

  it('produces outputs the gateway entitlement scanner accepts', () => {
    const built = buildPaymentTx({
      key,
      inputs: [{ txid: 'ab'.repeat(32), vout: 0, satoshis: 25_000_000_000, confirmations: 1 }],
      inputTotalZats: 25_000_000_000,
      paymentAddress: PAYMENT_ADDRESS,
      amountZats: 24_000_000_000, // 240 FLUX = annual
      memo: MEMO,
      feeZats: 10_000,
      tipHeight: 100,
    });
    const tx = utxolib.Transaction.fromHex(built.hex, FLUX_NETWORK);
    expect(tx.outs).toHaveLength(3);
    // Output 0: exact amount to the payment address.
    expect(utxolib.address.fromOutputScript(tx.outs[0]!.script, FLUX_NETWORK)).toBe(
      PAYMENT_ADDRESS,
    );
    expect(tx.outs[0]!.value).toBe(24_000_000_000);
    // Output 1: exactly one OP_RETURN carrying the memo, byte-for-byte.
    const script = tx.outs[1]!.script;
    expect(script[0]).toBe(0x6a); // OP_RETURN
    expect(script.subarray(2).toString('utf8')).toBe(MEMO);
    // Output 2: change back to the treasury.
    expect(utxolib.address.fromOutputScript(tx.outs[2]!.script, FLUX_NETWORK)).toBe(key.address);
    expect(tx.outs[2]!.value).toBe(25_000_000_000 - 24_000_000_000 - 10_000);
  });

  it('folds dust change into the fee', () => {
    const built = buildPaymentTx({
      key,
      inputs: [{ txid: 'cd'.repeat(32), vout: 0, satoshis: 2_000_010_500, confirmations: 1 }],
      inputTotalZats: 2_000_010_500,
      paymentAddress: PAYMENT_ADDRESS,
      amountZats: 2_000_000_000,
      memo: MEMO,
      feeZats: 10_000,
      tipHeight: 100,
    });
    const tx = utxolib.Transaction.fromHex(built.hex, FLUX_NETWORK);
    expect(tx.outs).toHaveLength(2); // 500 zats of would-be change went to fee
  });

  it('refuses to build when inputs are short', () => {
    expect(() =>
      buildPaymentTx({
        key,
        inputs: [{ txid: 'ef'.repeat(32), vout: 0, satoshis: 100, confirmations: 1 }],
        inputTotalZats: 100,
        paymentAddress: PAYMENT_ADDRESS,
        amountZats: 2_000_000_000,
        memo: MEMO,
        feeZats: 10_000,
        tipHeight: 100,
      }),
    ).toThrow();
  });
});

describe('utxo selection', () => {
  const utxo = (txid: string, vout: number, satoshis: number) => ({
    txid,
    vout,
    satoshis,
    confirmations: 1,
  });

  it('selects largest-first and stops when covered', () => {
    const sel = selectUtxos(
      [utxo('a', 0, 5e8), utxo('b', 0, 30e8), utxo('c', 0, 10e8)],
      new Set(),
      25e8,
    );
    expect(sel.inputs.map((u) => u.txid)).toEqual(['b']);
    expect(sel.totalZats).toBe(30e8);
  });

  it('skips outpoints held by in-flight txs (0-conf change chaining)', () => {
    const sel = selectUtxos([utxo('a', 0, 30e8), utxo('b', 1, 20e8)], new Set(['a:0']), 15e8);
    expect(sel.inputs.map((u) => u.txid)).toEqual(['b']);
  });

  it('throws InsufficientFundsError with the shortfall visible', () => {
    expect(() => selectUtxos([utxo('a', 0, 1e8)], new Set(), 20e8)).toThrow(InsufficientFundsError);
  });
});
