import { ed25519 } from '@noble/curves/ed25519.js';
import { base64 } from '@scure/base';
import { describe, expect, it } from 'vitest';
import { directoryVerify, discoverGateways, specToCountryCode } from './discovery.js';
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

describe('specToCountryCode', () => {
  it('maps the standard spec name to its country', () => {
    expect(specToCountryCode('cumulusvpnde')).toBe('DE');
    expect(specToCountryCode('cumulusvpnus')).toBe('US');
  });

  it('strips the `tls` stealth infix so the 443 group maps to its country', () => {
    expect(specToCountryCode('cumulusvpntlsde')).toBe('DE');
    expect(specToCountryCode('cumulusvpntlsus')).toBe('US');
  });

  it('does not over-strip a country code that itself starts with "tl" (Timor-Leste)', () => {
    // `tls` needs all three chars; `cumulusvpntl` is the standard TL spec.
    expect(specToCountryCode('cumulusvpntl')).toBe('TL');
    expect(specToCountryCode('cumulusvpntlstl')).toBe('TL');
  });
});

describe('discoverGateways', () => {
  it("probes /v1/info, falls back to the SPEC's country, and sorts by country then load", async () => {
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

  it("lists a gateway under the country it reports, not its spec's, when they disagree", async () => {
    // Flux placed a cumulusvpngb instance in France (seen on the live fleet):
    // its own signed /v1/info says FR, so it must not be offered as the UK.
    const fetchImpl: FetchImpl = async (input) => {
      const url = String(input);
      if (url.endsWith('/apps/location/cumulusvpngb')) {
        return jsonResponse({
          status: 'success',
          data: [{ ip: '1.1.1.1' }, { ip: '2.2.2.2' }, { ip: '3.3.3.3' }],
        });
      }
      if (url === 'http://1.1.1.1:51821/v1/info') {
        return signedResponse(info({ country: 'fr', load: 0.1 }), signer);
      }
      if (url === 'http://2.2.2.2:51821/v1/info') {
        return signedResponse(info({ country: 'GB', load: 0.2 }), signer);
      }
      if (url === 'http://3.3.3.3:51821/v1/info') {
        return signedResponse(info({ country: '??', load: 0.3 }), signer);
      }
      throw new Error(`unexpected fetch: ${url}`);
    };
    const gateways = await discoverGateways(['cumulusvpngb'], { fetchImpl });
    expect(gateways.map((g) => `${g.country}:${g.ip}`)).toEqual([
      'FR:1.1.1.1', // its own country, normalized
      'GB:2.2.2.2',
      'GB:3.3.3.3', // a malformed report falls back to the spec
    ]);
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

  it('reports each gateway as it verifies, without waiting for a slow candidate', async () => {
    let releaseSlow: () => void = () => undefined;
    const slow = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    const fetchImpl: FetchImpl = async (input) => {
      const url = String(input);
      if (url.endsWith('/apps/location/cumulusvpnus')) {
        return jsonResponse({ status: 'success', data: [{ ip: '1.1.1.1' }, { ip: '2.2.2.2' }] });
      }
      if (url === 'http://1.1.1.1:51821/v1/info') {
        return signedResponse(info({ country: 'US' }), signer);
      }
      await slow; // 2.2.2.2 answers only when released
      throw new Error('timed out');
    };
    const seen: string[] = [];
    let settled = false;
    const done = discoverGateways(['cumulusvpnus'], {
      fetchImpl,
      onGateway: (g) => seen.push(`${g.ip} ${g.country}`),
    }).then((all) => {
      settled = true;
      return all;
    });

    await expect.poll(() => seen).toEqual(['1.1.1.1 US']);
    expect(settled).toBe(false); // still waiting on 2.2.2.2
    releaseSlow();
    const all = await done;
    expect(all.map((g) => g.ip)).toEqual(['1.1.1.1']);
    expect(seen).toEqual(['1.1.1.1 US']); // a failed probe is never reported
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
