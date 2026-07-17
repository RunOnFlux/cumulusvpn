import { ed25519 } from '@noble/curves/ed25519.js';
import { base64 } from '@scure/base';
import { describe, expect, it } from 'vitest';
import { directoryVerify, discoverGateways } from './discovery.js';
import { jsonResponse, makeSignKeypair, signedResponse } from './testkit.js';
import type { Directory, FetchImpl, InfoResponse } from './types.js';

const signer = makeSignKeypair();

function info(overrides: Partial<InfoResponse>): InfoResponse {
  return {
    country: 'DE',
    region: 'HE',
    city: 'Frankfurt',
    load: 0.1,
    capacity: 100,
    version: '0.1.0-poc',
    min_client_version: '0.1.0',
    server_pubkey: 'SERVER_PUB',
    sign_pubkey: signer.publicKeyB64,
    ...overrides,
  };
}

describe('discoverGateways', () => {
  it('queries Flux + nodes, probes /v1/info, and returns verified gateways sorted by country then load', async () => {
    const routes: Record<string, Response> = {
      'https://api.runonflux.io/apps/location/cumulusde': jsonResponse({
        status: 'success',
        data: [{ ip: '1.2.3.4:16127' }, { ip: '5.6.7.8' }],
      }),
      'http://9.9.9.9:16127/apps/location/cumulusde': jsonResponse({
        status: 'success',
        data: [{ ip: '10.0.0.1' }],
      }),
      'http://1.2.3.4:51821/v1/info': signedResponse(info({ country: 'DE', load: 0.5 }), signer),
      'http://5.6.7.8:51821/v1/info': signedResponse(info({ country: 'AT', load: 0.2 }), signer),
      'http://10.0.0.1:51821/v1/info': signedResponse(info({ country: 'DE', load: 0.1 }), signer),
    };
    const calls: string[] = [];
    const fetchImpl: FetchImpl = async (input) => {
      const url = String(input);
      calls.push(url);
      const res = routes[url];
      if (!res) {
        throw new Error(`unexpected fetch: ${url}`);
      }
      return res;
    };

    const gateways = await discoverGateways(['cumulusde'], { nodes: ['9.9.9.9'], fetchImpl });

    expect(gateways.map((g) => `${g.country}:${g.ip}`)).toEqual([
      'AT:5.6.7.8', // country asc
      'DE:10.0.0.1', // then load asc within DE (0.1 before 0.5)
      'DE:1.2.3.4',
    ]);
    // port was stripped from the api.runonflux entry
    expect(calls).toContain('http://1.2.3.4:51821/v1/info');
    // node index was queried directly
    expect(calls).toContain('http://9.9.9.9:16127/apps/location/cumulusde');
  });

  it('drops unreachable candidates', async () => {
    const fetchImpl: FetchImpl = async (input) => {
      const url = String(input);
      if (url.endsWith('/apps/location/cumulusus')) {
        return jsonResponse({ status: 'success', data: [{ ip: '1.1.1.1' }, { ip: '2.2.2.2' }] });
      }
      if (url === 'http://1.1.1.1:51821/v1/info') {
        return signedResponse(info({ country: 'US' }), signer);
      }
      throw new Error('connection refused');
    };
    const gateways = await discoverGateways(['cumulusus'], { fetchImpl });
    expect(gateways).toHaveLength(1);
    expect(gateways[0]!.ip).toBe('1.1.1.1');
  });

  it('rejects a gateway whose /v1/info signature is invalid', async () => {
    const otherSigner = makeSignKeypair();
    const fetchImpl: FetchImpl = async (input) => {
      const url = String(input);
      if (url.endsWith('/apps/location/cumulusde')) {
        return jsonResponse({ status: 'success', data: [{ ip: '3.3.3.3' }] });
      }
      // Body is signed by otherSigner but advertises signer's pubkey → invalid.
      const forged = signedResponse(info({}), otherSigner);
      return new Response(await forged.text(), {
        status: 200,
        headers: {
          'X-CVPN-Signature': forged.headers.get('X-CVPN-Signature')!,
          'X-CVPN-Sign-PubKey': signer.publicKeyB64,
        },
      });
    };
    const gateways = await discoverGateways(['cumulusde'], { fetchImpl });
    expect(gateways).toHaveLength(0);
  });
});

// Local canonicalizer mirroring discovery.ts, used only to produce a valid sig.
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

function signDirectory(unsigned: Omit<Directory, 'sig'>, secret: Uint8Array): Directory {
  const msg = new TextEncoder().encode(canonical(unsigned));
  return { ...unsigned, sig: base64.encode(ed25519.sign(msg, secret)) };
}

describe('directoryVerify', () => {
  const secret = ed25519.utils.randomSecretKey();
  const pubB64 = base64.encode(ed25519.getPublicKey(secret));
  const base: Omit<Directory, 'sig'> = {
    version: 1,
    updated: '2026-07-16T00:00:00Z',
    payment_address: 't1abc',
    price_flux: 4.5,
    specs: ['cumulusde', 'cumulusus'],
    seed_gateways: [{ ip: '1.2.3.4', country: 'DE', sign_pubkey: 'x' }],
  };

  it('accepts a correctly signed directory', () => {
    expect(directoryVerify(signDirectory(base, secret), pubB64)).toBe(true);
  });

  it('rejects a tampered directory', () => {
    const dir = signDirectory(base, secret);
    const tampered: Directory = { ...dir, price_flux: 0.01 };
    expect(directoryVerify(tampered, pubB64)).toBe(false);
  });

  it('rejects the wrong verifying key', () => {
    const other = base64.encode(ed25519.getPublicKey(ed25519.utils.randomSecretKey()));
    expect(directoryVerify(signDirectory(base, secret), other)).toBe(false);
  });
});
