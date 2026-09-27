/**
 * The FLUX price schedule — a port of the gateway's internal/price, and it
 * must stay byte-compatible with it (and with deploy/scripts/price.mjs):
 * every gateway judges the bridge's settlement txs by exactly these rules.
 *
 *   20                  flat price for all of history (legacy PRICE_FLUX)
 *   20@0,12@2215000     20 FLUX until block 2214999, 12 FLUX from 2215000
 *
 * A tx is judged against the EFFECTIVE price at its own height: the lowest
 * price in force at any point in the preceding GRACE_BLOCKS (72 h). So a
 * reprice never re-judges an already-mined tx, and a payer caught by a rise
 * mid-flight still gets their full month. docs/04-payments.md.
 */

/** 72 h at the 30 s post-PON block time. Mirrors price.GraceBlocks. */
export const GRACE_BLOCKS = 8640;

const MAX_ENTRIES = 256;

export interface PriceEntry {
  readonly from: number;
  readonly flux: number;
}

export class PriceSchedule {
  private constructor(readonly entries: readonly PriceEntry[]) {}

  /** A single price for all of history. */
  static flat(flux: number): PriceSchedule {
    if (!(flux > 0) || !Number.isFinite(flux)) {
      throw new Error('price: price must be a positive number');
    }
    return new PriceSchedule([{ from: 0, flux }]);
  }

  static parse(raw: string): PriceSchedule {
    const s = raw.trim();
    if (s === '') {
      throw new Error('price: empty schedule');
    }
    const parts = s.split(',');
    if (parts.length > MAX_ENTRIES) {
      throw new Error(`price: ${parts.length} entries, max ${MAX_ENTRIES}`);
    }
    const entries: PriceEntry[] = [];
    parts.forEach((part, i) => {
      const entry = part.trim();
      const at = entry.indexOf('@');
      const fluxStr = (at === -1 ? entry : entry.slice(0, at)).trim();
      // Plain decimals only, ≤ 9 integer digits and ≤ 8 decimals (one zat) —
      // exactly what the Go parser accepts (see its fluxRe).
      const flux = /^\d{1,9}(\.\d{1,8})?$/.test(fluxStr) ? Number(fluxStr) : NaN;
      if (!(flux > 0) || !Number.isFinite(flux)) {
        throw new Error(`price: entry ${i + 1} "${entry}": price must be a positive number`);
      }
      let from = 0;
      if (at !== -1) {
        const fromStr = entry.slice(at + 1).trim();
        if (!/^\d{1,16}$/.test(fromStr) || !Number.isSafeInteger(Number(fromStr))) {
          throw new Error(
            `price: entry ${i + 1} "${entry}": height must be a non-negative integer`,
          );
        }
        from = Number(fromStr);
      } else if (i > 0) {
        throw new Error(`price: entry ${i + 1} "${entry}": needs an @height`);
      }
      if (i === 0 && from !== 0) {
        throw new Error(`price: first entry "${entry}" must start at height 0`);
      }
      const prev = entries[i - 1];
      if (prev && from <= prev.from) {
        throw new Error(`price: entry ${i + 1} "${entry}": heights must strictly increase`);
      }
      entries.push({ from, flux });
    });
    return new PriceSchedule(entries);
  }

  /** Canonical wire form, identical to the gateway's Schedule.String(). */
  toString(): string {
    return this.entries.map((e) => `${formatFlux(e.flux)}@${e.from}`).join(',');
  }

  /** The last entry's price — what the legacy PRICE_FLUX should say. */
  latest(): number {
    return this.entries[this.entries.length - 1]!.flux;
  }

  private index(h: number): number {
    let i = this.entries.length - 1;
    while (i > 0 && this.entries[i]!.from > h) {
      i--;
    }
    return i;
  }

  /** The price in force at height h: what a new payment is quoted. */
  at(h: number): number {
    return this.entries[this.index(h)]!.flux;
  }

  /** The price a tx mined at height h is judged against. */
  effective(h: number): number {
    const i = this.index(h);
    let p = this.entries[i]!.flux;
    const lo = h - GRACE_BLOCKS;
    // Entry j was in force over [from_j, from_{j+1}); it overlaps the grace
    // window iff it was still in force at lo.
    for (let j = i - 1; j >= 0 && this.entries[j + 1]!.from > lo; j--) {
      p = Math.min(p, this.entries[j]!.flux);
    }
    return p;
  }

  /**
   * The highest effective price over heights [from, to] — what a payout must
   * be sized at when the tx may be mined anywhere in that range. Effective
   * only changes at an entry start or where a grace window ends, so checking
   * `from` plus every such boundary inside the range is exhaustive.
   */
  maxEffective(from: number, to: number): number {
    let p = this.effective(from);
    for (const e of this.entries) {
      for (const b of [e.from, e.from + GRACE_BLOCKS]) {
        if (b > from && b <= to) {
          p = Math.max(p, this.effective(b));
        }
      }
    }
    return p;
  }
}

/** Shortest plain decimal (never exponent form, which `${n}` uses below 1e-6). */
function formatFlux(flux: number): string {
  return flux.toFixed(8).replace(/\.?0+$/, '');
}

/** Whole zats for a FLUX price, rounded like the config always has. */
export function fluxToZats(flux: number): number {
  return Math.round(flux * 1e8);
}
