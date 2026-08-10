/**
 * Chain access — insight-style explorer API primary, FluxOS daemon
 * pass-through fallback (same dual-source discipline as the gateway's
 * internal/fluxnode). All amounts are integer zats.
 *
 * FluxOS quirk (hard-won): never send a JSON content-type to FluxOS
 * endpoints — requests hang. The fallback path uses plain GETs only.
 */

export interface Utxo {
  readonly txid: string;
  readonly vout: number;
  readonly satoshis: number;
  readonly confirmations: number;
}

export interface TxInfo {
  readonly confirmations: number;
}

const TIMEOUT_MS = 20_000;

async function get(url: string): Promise<unknown> {
  const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) {
    throw new Error(`chain: GET ${new URL(url).pathname} -> ${r.status}`);
  }
  return r.json();
}

export class ChainClient {
  constructor(
    private readonly explorerUrl: string,
    private readonly fallbackUrl: string,
  ) {}

  /** Confirmed + mempool UTXOs for an address (insight includes 0-conf). */
  async utxos(address: string): Promise<Utxo[]> {
    const raw = (await get(`${this.explorerUrl}/addr/${address}/utxo`)) as {
      txid: string;
      vout: number;
      satoshis: number;
      confirmations: number;
    }[];
    return raw.map((u) => ({
      txid: u.txid,
      vout: u.vout,
      satoshis: u.satoshis,
      confirmations: u.confirmations,
    }));
  }

  /** Current chain height, explorer first, FluxOS daemon fallback. */
  async tipHeight(): Promise<number> {
    try {
      const info = (await get(`${this.explorerUrl}/status?q=getInfo`)) as {
        info?: { blocks?: number };
      };
      const blocks = info.info?.blocks;
      if (typeof blocks === 'number' && blocks > 0) {
        return blocks;
      }
      throw new Error('chain: bad getInfo shape');
    } catch {
      const res = (await get(`${this.fallbackUrl}/daemon/getblockcount`)) as {
        status?: string;
        data?: number;
      };
      if (res.status !== 'success' || typeof res.data !== 'number') {
        throw new Error('chain: getblockcount fallback failed');
      }
      return res.data;
    }
  }

  /**
   * Look up a tx. The distinction in the return type is LOAD-BEARING for the
   * confirmer: `'not-found'` is a POSITIVE answer and may justify a rebuild;
   * a transport error THROWS — an errored lookup must never be read as "tx
   * vanished", because resetting a payment whose tx actually mined
   * double-pays it.
   *
   * 'not-found' therefore requires the DAEMON's specific RPC "No information
   * available" answer (code -5, verified live against api.runonflux.io,
   * whose backends run txindex). An explorer 404 alone never decides — a
   * stalled insight indexer 404s for freshly mined txs — and any other
   * daemon error (overload, proxy, syncing backend) throws rather than
   * masquerading as an answer.
   */
  async tx(txid: string): Promise<TxInfo | 'not-found'> {
    let explorerErr: unknown;
    try {
      const r = await fetch(`${this.explorerUrl}/tx/${txid}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (r.ok) {
        const raw = (await r.json()) as { confirmations?: number };
        return { confirmations: raw.confirmations ?? 0 };
      }
      explorerErr = new Error(`chain: tx lookup -> ${r.status}`);
    } catch (e) {
      explorerErr = e;
    }
    // FluxOS daemon (GET only — JSON bodies hang FluxOS).
    const res = (await get(
      `${this.fallbackUrl}/daemon/getrawtransaction?txid=${txid}&verbose=1`,
    )) as {
      status?: string;
      data?: { confirmations?: number; code?: number };
    };
    if (res.status === 'success' && res.data && typeof res.data === 'object') {
      return { confirmations: res.data.confirmations ?? 0 };
    }
    if (res.status === 'error' && res.data?.code === -5) {
      return 'not-found';
    }
    throw explorerErr instanceof Error ? explorerErr : new Error(String(explorerErr));
  }

  /** Broadcast a signed raw tx; returns the txid the network accepted. */
  async broadcast(hex: string): Promise<string> {
    try {
      const r = await fetch(`${this.explorerUrl}/tx/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rawtx: hex }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!r.ok) {
        throw new Error(`chain: tx/send -> ${r.status} ${(await r.text()).slice(0, 200)}`);
      }
      const body = (await r.json()) as { txid?: string | { result?: string } };
      const txid = typeof body.txid === 'string' ? body.txid : body.txid?.result;
      if (!txid) {
        throw new Error('chain: tx/send returned no txid');
      }
      return txid;
    } catch (explorerErr) {
      // FluxOS daemon pass-through: GET with query args only (JSON bodies hang).
      const res = (await get(`${this.fallbackUrl}/daemon/sendrawtransaction?hexstring=${hex}`)) as {
        status?: string;
        data?: unknown;
      };
      if (res.status === 'success' && typeof res.data === 'string') {
        return res.data;
      }
      throw explorerErr instanceof Error ? explorerErr : new Error(String(explorerErr));
    }
  }

  /** Address balance in zats (confirmed + unconfirmed). */
  async balanceZats(address: string): Promise<number> {
    const confirmed = (await get(`${this.explorerUrl}/addr/${address}/balance`)) as number;
    const unconfirmed = (await get(
      `${this.explorerUrl}/addr/${address}/unconfirmedBalance`,
    )) as number;
    return confirmed + unconfirmed;
  }
}
