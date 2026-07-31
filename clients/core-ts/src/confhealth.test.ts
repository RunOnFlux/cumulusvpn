import { describe, expect, it } from 'vitest';
import { checkIssuedConfig } from './confhealth.js';
import { makeSignKeypair, signedResponse } from './testkit.js';
import type { InfoResponse } from './types.js';

const signer = makeSignKeypair();

/** A signed /v1/info body, as a gateway would serve it. */
function infoFor(serverPubKey: string): InfoResponse {
  return {
    country: 'DE',
    region: 'HE',
    city: 'Frankfurt',
    load: 0.1,
    capacity: 100,
    version: '0.2.0',
    min_client_version: '0.1.0',
    server_pubkey: serverPubKey,
    sign_pubkey: signer.publicKeyB64,
  };
}

function fetchReturning(res: () => Response) {
  return (() => Promise.resolve(res())) as unknown as typeof fetch;
}

describe('checkIssuedConfig', () => {
  it('says ok when the gateway still presents the key the config pinned', async () => {
    const key = 'srv+pub/key/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa=';
    const got = await checkIssuedConfig(
      { ip: '203.0.113.7', serverPubKey: key },
      { fetchImpl: fetchReturning(() => signedResponse(infoFor(key), signer)) },
    );
    expect(got).toBe('ok');
  });

  // The migration case: the app was re-placed on a different Flux node, which
  // minted its own server key and has no record of this peer. The issued config
  // can never handshake again, and this is the only signal available to a page
  // that wants to warn the user before they discover it as "no internet".
  it('says replaced when the gateway now presents a different key', async () => {
    const got = await checkIssuedConfig(
      { ip: '203.0.113.7', serverPubKey: 'srv+pub/key/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa=' },
      {
        fetchImpl: fetchReturning(() =>
          signedResponse(infoFor('DIFFERENT+key/aaaaaaaaaaaaaaaaaaaaaaaaaaaa='), signer),
        ),
      },
    );
    expect(got).toBe('replaced');
  });

  // Unreachable must NOT be reported as breakage: it is equally consistent with
  // the user being offline, so the UI has to hedge rather than tell them their
  // config is dead when it may be fine.
  it('says unreachable, not replaced, when the gateway does not answer', async () => {
    const got = await checkIssuedConfig(
      { ip: '203.0.113.7', serverPubKey: 'srv+pub/key=' },
      {
        fetchImpl: (() => Promise.reject(new Error('network'))) as unknown as typeof fetch,
      },
    );
    expect(got).toBe('unreachable');
  });

  it('says unknown with nothing stored, and never throws', async () => {
    expect(await checkIssuedConfig(null)).toBe('unknown');
    expect(await checkIssuedConfig({ ip: '', serverPubKey: 'x' })).toBe('unknown');
    expect(await checkIssuedConfig({ ip: '1.2.3.4', serverPubKey: '' })).toBe('unknown');
  });

  // A tampered body must not be read as a healthy gateway: the check has to be
  // signature-verified, or a hostile network could keep a dead config looking
  // alive (or, more likely here, a proxy mangling the body would read as "ok").
  it('does not report ok on an unverifiable body', async () => {
    const good = signedResponse(infoFor('srv+pub/key='), signer);
    const tampered = (await good.text()).replace('Frankfurt', 'Berlin____');
    const got = await checkIssuedConfig(
      { ip: '203.0.113.7', serverPubKey: 'srv+pub/key=' },
      { fetchImpl: fetchReturning(() => new Response(tampered, { status: 200 })) },
    );
    expect(got).not.toBe('ok');
  });
});
