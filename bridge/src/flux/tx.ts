/**
 * Flux transaction construction — transparent v4 Sapling txs (overwintered,
 * version group 0x892F2085, ZIP-243 sighash on consensus branch 0x76b809bb),
 * built and signed with @runonflux/utxo-lib's `flux` network definition.
 *
 * Shape of every payment tx (the exact shape gateway/internal/entitle
 * grants on): one output of months x price to the payment address, exactly
 * one OP_RETURN carrying "CVPN1:<code>", change back to the treasury.
 * `nExpiryHeight` = tip + EXPIRY_DELTA means an unmined tx dies on its own
 * and the payment row can be safely rebuilt — no double-grant risk.
 */
import utxolib from '@runonflux/utxo-lib';

import type { Utxo } from './chain.js';

/** Flux mainnet params (P2PKH 0x1cb8 `t1`, P2SH 0x1cbd `t3`, Sapling branch). */
export const FLUX_NETWORK = utxolib.networks.flux!;

export const SAPLING_VERSION_GROUP_ID = 0x892f2085;

/** Blocks until an unmined tx expires (~30 s blocks -> ~20 min). */
export const EXPIRY_DELTA = 40;

/** Below this, change is folded into the fee instead of creating dust. */
const DUST_ZATS = 1000;

export interface TreasuryKey {
  readonly address: string;
  readonly sign: (
    txb: InstanceType<typeof utxolib.TransactionBuilder>,
    index: number,
    valueZats: number,
  ) => void;
}

/** Decode the treasury WIF once; expose only the address and a signer. */
export function treasuryKeyFromWif(wif: string): TreasuryKey {
  const keyPair = utxolib.ECPair.fromWIF(wif, FLUX_NETWORK);
  return {
    address: keyPair.getAddress(),
    sign: (txb, index, valueZats) => {
      txb.sign(index, keyPair, null, utxolib.Transaction.SIGHASH_ALL, valueZats);
    },
  };
}

export interface BuiltTx {
  readonly hex: string;
  readonly txid: string;
  readonly expiryHeight: number;
  readonly spent: readonly { txid: string; vout: number }[];
}

export interface BuildParams {
  readonly key: TreasuryKey;
  readonly inputs: readonly Utxo[];
  readonly inputTotalZats: number;
  readonly paymentAddress: string;
  readonly amountZats: number;
  readonly memo: string;
  readonly feeZats: number;
  readonly tipHeight: number;
}

/** Build + sign a payment tx. Inputs must already cover amount + fee. */
export function buildPaymentTx(p: BuildParams): BuiltTx {
  const change = p.inputTotalZats - p.amountZats - p.feeZats;
  if (change < 0) {
    throw new Error('buildPaymentTx: inputs do not cover amount + fee');
  }
  const expiryHeight = p.tipHeight + EXPIRY_DELTA;

  const txb = new utxolib.TransactionBuilder(FLUX_NETWORK);
  txb.setVersion(4);
  txb.setVersionGroupId(SAPLING_VERSION_GROUP_ID);
  txb.setExpiryHeight(expiryHeight);

  for (const u of p.inputs) {
    txb.addInput(u.txid, u.vout);
  }
  txb.addOutput(p.paymentAddress, p.amountZats);
  txb.addOutput(utxolib.script.nullData.output.encode(Buffer.from(p.memo, 'utf8')), 0);
  if (change >= DUST_ZATS) {
    txb.addOutput(p.key.address, change);
  }

  p.inputs.forEach((u, i) => {
    p.key.sign(txb, i, u.satoshis);
  });

  const tx = txb.build();
  return {
    hex: tx.toHex(),
    txid: tx.getId(),
    expiryHeight,
    spent: p.inputs.map((u) => ({ txid: u.txid, vout: u.vout })),
  };
}
