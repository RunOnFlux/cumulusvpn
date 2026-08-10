/**
 * UTXO selection for treasury spends. Largest-first keeps the input count
 * (and so the tx size) minimal; the caller excludes outpoints already
 * consumed by our own in-flight txs, and 0-conf change from our own prior
 * broadcasts is spendable so back-to-back renewals never stall.
 */
import type { Utxo } from './chain.js';

export interface Selection {
  readonly inputs: Utxo[];
  readonly totalZats: number;
}

export class InsufficientFundsError extends Error {
  constructor(neededZats: number, availableZats: number) {
    super(`treasury has ${availableZats} zats, need ${neededZats}`);
    this.name = 'InsufficientFundsError';
  }
}

export function selectUtxos(
  available: readonly Utxo[],
  excluded: ReadonlySet<string>,
  neededZats: number,
): Selection {
  const usable = available
    .filter((u) => !excluded.has(`${u.txid}:${u.vout}`))
    .sort((a, b) => b.satoshis - a.satoshis);
  const inputs: Utxo[] = [];
  let total = 0;
  for (const u of usable) {
    inputs.push(u);
    total += u.satoshis;
    if (total >= neededZats) {
      return { inputs, totalZats: total };
    }
  }
  throw new InsufficientFundsError(neededZats, total);
}
