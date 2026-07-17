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
  it('probes /v1/info, tags country from the SPEC (not the gateway), and sorts by country then load', async () => {
    const routes: Record<string, Response> = {
      // AT spec: one gateway from Flux; the node index has none.
      'https://api.runonflux.io/apps/location/cumulusvpnat': jsonResponse({
        status: 'success',
        data: [{ ip: '5.6.7.8' }],
      }),
      'http://9.9.9.9:16127/apps/location/cumulusvpnat': jsonResponse({
        status: 'success',
        data: [],
      }),
      // DE spec: one from Flux (with a :port to strip) + one from the node index.
      'https://api.runonflux.io/apps/location/cumulusvpnde': jsonResponse({
        status: 'success',
        data: [{ ip: '1.2.3.4:16127' }],
      }),
      'http://9.9.9.9:16127/apps/location/cumulusvpnde': jsonResponse({
        status: 'success',
        data: [{ ip: '10.0.0.1' }],
      }),
      // Gateways report NO country of their own (as on Flux, where hostinfo is
      // unavailable) — the spec name supplies the authoritative country.
      'http://5.6.7.8:51821/v1/info': signedResponse(info({ country: '', load: 0.2 }), signer),
      'http://1.2.3.4:51821/v1/info': signedResponse(info({ country: '', load: 0.5 }), signer),
      'http://10.0.0.1:51821/v1/info': signedResponse(info({ country: '', load: 0.1 }), signer),
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

    const gateways = await discoverGateways(['cumulusvpnat', 'cumulusvpnde'], {
      nodes: ['9.9.9.9'],
      fetchImpl,
    });

    // Country comes from the spec (cumulusvpn<cc>), so DE gateways group together.
    expect(gateways.map((g) => `${g.country}:${g.ip}`)).toEqual([
      'AT:5.6.7.8', // country asc
      'DE:10.0.0.1', // then load asc within DE (0.1 before 0.5)
      'DE:1.2.3.4',
    ]);
    // port was stripped from the api.runonflux entry
    expect(calls).toContain('http://1.2.3.4:51821/v1/info');
    // node index was queried directly
    expect(calls).toContain('http://9.9.9.9:16127/apps/location/cumulusvpnde');
  });

  it('drops unreachable candidates', async () => {
    const fetchImpl: FetchImpl = async (input) => {
      const url = String(input);
      if (url.endsWith('/apps/location/cumulusvpnus')) {
        return jsonResponse({ status: 'success', data: [{ ip: '1.1.1.1' }, { ip: '2.2.2.2' }] });
      }
      if (url === 'http://1.1.1.1:51821/v1/info') {
        return signedResponse(info({ country: 'US' }), signer);
      }
      throw new Error('connection refused');
    };
    const gateways = await discoverGateways(['cumulusvpnus'], { fetchImpl });
    expect(gateways).toHaveLength(1);
    expect(gateways[0]!.ip).toBe('1.1.1.1');
  });

  it('rejects a gateway whose /v1/info signature is invalid', async () => {
    const otherSigner = makeSignKeypair();
    const fetchImpl: FetchImpl = async (input) => {
      const url = String(input);
      if (url.endsWith('/apps/location/cumulusvpnde')) {
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
    const gateways = await discoverGateways(['cumulusvpnde'], { fetchImpl });
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
    price_flux: 20,
    specs: ['cumulusvpnde', 'cumulusvpnus'],
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

  // The REAL shipped directory (deploy/directory/make-directory.mjs) signs the
  // payload WITHOUT `sign_pubkey`, then adds `sign_pubkey` to the artifact. So a
  // valid directory carries a sign_pubkey field that is NOT part of the signature.
  // Verification must ignore it (regression: it used to be included, which made
  // every real directory fail → clients showed "no gateways / no countries").
  it('accepts a signed directory that carries a sign_pubkey field', () => {
    const signed = signDirectory(base, secret);
    const withPubkey: Directory = { ...signed, sign_pubkey: pubB64 };
    expect(directoryVerify(withPubkey, pubB64)).toBe(true);
  });
});
