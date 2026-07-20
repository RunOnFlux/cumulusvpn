import { describe, expect, it } from 'vitest';
import {
  paymentCode,
  paymentMemo,
  walletDeepLink,
  walletDeepLinks,
  WALLET_SCHEMES,
} from './paymentCode.js';

// Known vectors: code = base58btc(sha256(rawPub)[0:20]). Computed independently
// and cross-checked to match the gateway's entitle.PaymentCode().
const ZERO_PUB = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const ZERO_CODE = '2RkUfDC55GMndKreXqK7Jruu8Snx';
const SEQ_PUB = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
const SEQ_CODE = '2P3H7nHnykfHALDcRjxfRLo1Pfdm';

describe('paymentCode', () => {
  it('matches the known vector for the all-zero pubkey', () => {
    expect(paymentCode(ZERO_PUB)).toBe(ZERO_CODE);
  });

  it('matches the known vector for the 0..31 sequence pubkey', () => {
    expect(paymentCode(SEQ_PUB)).toBe(SEQ_CODE);
  });

  it('only uses base58 (Bitcoin) alphabet characters', () => {
    expect(paymentCode(SEQ_PUB)).toMatch(
      /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/,
    );
  });

  it('throws when the pubkey is not 32 bytes', () => {
    expect(() => paymentCode('AAAA')).toThrow(/32-byte/);
  });
});

describe('paymentMemo', () => {
  it('prefixes the code with CVPN1:', () => {
    expect(paymentMemo(ZERO_PUB)).toBe(`CVPN1:${ZERO_CODE}`);
  });
});

describe('walletDeepLink', () => {
  const memo = paymentMemo(ZERO_PUB);

  it('defaults to the zel: scheme (Zelcore) with the contract payload', () => {
    expect(walletDeepLink('t1abc', 20, memo)).toBe(
      `zel:t1abc?amount=20&message=CVPN1:${ZERO_CODE}`,
    );
  });

  it('builds the flux: URI when asked', () => {
    expect(walletDeepLink('t1abc', 20, memo, 'flux')).toBe(
      `flux:t1abc?amount=20&message=CVPN1:${ZERO_CODE}`,
    );
  });

  it('builds the ssp: URI when asked', () => {
    expect(walletDeepLink('t1abc', 20, memo, 'ssp')).toBe(
      `ssp:t1abc?amount=20&message=CVPN1:${ZERO_CODE}`,
    );
  });
});

describe('walletDeepLinks', () => {
  const memo = paymentMemo(ZERO_PUB);

  it('returns one URI per scheme in preference order (zel, flux, ssp)', () => {
    const links = walletDeepLinks('t1abc', 20, memo);
    expect(links.map((l) => l.scheme)).toEqual([...WALLET_SCHEMES]);
    expect(links.map((l) => l.scheme)).toEqual(['zel', 'flux', 'ssp']);
    for (const { scheme, uri } of links) {
      expect(uri).toBe(`${scheme}:t1abc?amount=20&message=CVPN1:${ZERO_CODE}`);
    }
  });
});
