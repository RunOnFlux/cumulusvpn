import { describe, expect, it } from 'vitest';
import { paymentCode, paymentMemo, walletDeepLink } from './paymentCode.js';

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
  it('builds the flux: URI exactly per contract', () => {
    const memo = paymentMemo(ZERO_PUB);
    expect(walletDeepLink('t1abc', 4.5, memo)).toBe(
      `flux:t1abc?amount=4.5&message=CVPN1:${ZERO_CODE}`,
    );
  });
});
