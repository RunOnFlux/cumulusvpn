import { describe, expect, it } from 'vitest';
import { ApiError } from './http.js';
import { enroll, status } from './enroll.js';
import { errorResponse, makeSignKeypair, signedResponse } from './testkit.js';
import { verifyPoW } from './pow.js';
import type { EnrollResponse, FetchImpl, StatusResponse } from './types.js';

const signer = makeSignKeypair();
const PUB = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

const enrollData: EnrollResponse = {
  server_pubkey: 'SERVER_PUB',
  endpoint: '1.2.3.4:51820',
  assigned_ip: '10.8.0.2',
  dns: '1.1.1.1',
  payment_address: 't1abc',
  payment_memo: 'CVPN1:2RkUfDC55GMndKreXqK7Jruu8Snx',
  price_flux: 4.5,
};

describe('enroll', () => {
  it('solves a valid PoW, posts /v1/enroll, and returns the verified data', async () => {
    let sentBody: { pubkey: string; pow_nonce: string } | undefined;
    const fetchImpl: FetchImpl = async (input, init) => {
      expect(String(input)).toBe('http://1.2.3.4:51821/v1/enroll');
      expect(init?.method).toBe('POST');
      sentBody = JSON.parse(String(init?.body));
      return signedResponse(enrollData, signer);
    };

    const res = await enroll('1.2.3.4', PUB, { fetchImpl, powBits: 8 });
    expect(res).toEqual(enrollData);
    expect(sentBody).toBeDefined();
    expect(verifyPoW(PUB, sentBody!.pow_nonce, 8)).toBe(true);
  });

  it('throws ApiError with the slug on an error envelope', async () => {
    const fetchImpl: FetchImpl = async () =>
      errorResponse(429, 'rate_limited', 'enroll rate limit');
    await expect(enroll('1.2.3.4', PUB, { fetchImpl, powBits: 8 })).rejects.toMatchObject({
      slug: 'rate_limited',
      code: '429',
    });
    await expect(enroll('1.2.3.4', PUB, { fetchImpl, powBits: 8 })).rejects.toBeInstanceOf(
      ApiError,
    );
  });

  it('rejects a response signed by the wrong key when a pin is provided', async () => {
    const attacker = makeSignKeypair();
    const fetchImpl: FetchImpl = async () => signedResponse(enrollData, attacker);
    await expect(
      enroll('1.2.3.4', PUB, { fetchImpl, powBits: 8, signPubKey: signer.publicKeyB64 }),
    ).rejects.toThrow(/unverified/);
  });
});

describe('status', () => {
  it('URL-escapes the pubkey and returns the verified status', async () => {
    const statusData: StatusResponse = {
      tier: 'premium',
      paid_until: '2026-09-01T00:00:00Z',
      bytes_used: 1024,
    };
    const fetchImpl: FetchImpl = async (input) => {
      expect(String(input)).toBe(`http://1.2.3.4:51821/v1/status/${encodeURIComponent(PUB)}`);
      return signedResponse(statusData, signer);
    };
    const res = await status('1.2.3.4', PUB, { fetchImpl });
    expect(res).toEqual(statusData);
  });
});
