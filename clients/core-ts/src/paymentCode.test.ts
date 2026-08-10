import { describe, expect, it } from 'vitest';
import {
  appAccountToken,
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

describe('appAccountToken', () => {
  // SHARED VECTORS with bridge/test/codes.test.ts — the bridge recomputes
  // this UUID at verify time and rejects a mismatch, so client and server
  // derivations must never drift. Update both files together (and remap
  // existing subscriptions) if the derivation ever changes.
  const ONES_CODE = '2bmMSbm88eN6MA6RuDiFKjNAZEuk'; // paymentCode of 32 x 0x01

  it('matches the shared cross-package vectors', () => {
    expect(appAccountToken(ZERO_CODE)).toBe('d47c7e4b-c0f7-421c-a429-72ad6e9ecaf3');
    expect(appAccountToken(ONES_CODE)).toBe('b2cc0e5c-45f5-4846-9d80-1fffa5f63323');
  });

  it('is a stable RFC 4122-shaped UUID', () => {
    const uuid = appAccountToken(SEQ_CODE);
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(appAccountToken(SEQ_CODE)).toBe(uuid);
    expect(appAccountToken(ZERO_CODE)).not.toBe(uuid);
  });
});

describe('walletDeepLink', () => {
  const memo = paymentMemo(ZERO_PUB);
  // The memo's ':' must be percent-encoded so wallets that split the URI on ':'
  // don't mistake the fragment after it for the destination address.
  const encMemo = `CVPN1%3A${ZERO_CODE}`;

  it('defaults to the Zelcore zel: protocol form with all values URI-encoded', () => {
    expect(walletDeepLink('t1abc', 20, memo)).toBe(
      `zel:?action=pay&coin=flux&address=t1abc&amount=20&message=${encMemo}`,
    );
  });

  it('encodes the memo colon so Zelcore does not misparse the address', () => {
    // The raw ':' must not survive into the URI (that is the bug we are fixing).
    expect(walletDeepLink('t1abc', 20, memo)).not.toContain(`CVPN1:${ZERO_CODE}`);
    expect(walletDeepLink('t1abc', 20, memo)).toContain('%3A');
  });

  it('builds a BIP21 flux: URI (encoded message) when asked', () => {
    expect(walletDeepLink('t1abc', 20, memo, 'flux')).toBe(
      `flux:t1abc?amount=20&message=${encMemo}`,
    );
  });

  it('builds a BIP21 ssp: URI (encoded message) when asked', () => {
    expect(walletDeepLink('t1abc', 20, memo, 'ssp')).toBe(`ssp:t1abc?amount=20&message=${encMemo}`);
  });

  it('round-trips the memo: decoding the message yields the exact on-chain memo', () => {
    const uri = walletDeepLink('t1abc', 20, memo, 'flux');
    const message = new URLSearchParams(uri.split('?')[1]).get('message');
    expect(message).toBe(`CVPN1:${ZERO_CODE}`);
  });
});

describe('walletDeepLinks', () => {
  const memo = paymentMemo(ZERO_PUB);

  it('returns one URI per scheme in preference order (zel, flux, ssp)', () => {
    const links = walletDeepLinks('t1abc', 20, memo);
    expect(links.map((l) => l.scheme)).toEqual([...WALLET_SCHEMES]);
    expect(links.map((l) => l.scheme)).toEqual(['zel', 'flux', 'ssp']);
    // zel: uses the protocol form; flux:/ssp: use BIP21 — all with encoded memo.
    expect(links[0].uri.startsWith('zel:?action=pay')).toBe(true);
    for (const { uri } of links) {
      expect(uri).toContain('%3A');
      expect(uri).not.toContain(`CVPN1:${ZERO_CODE}`);
    }
  });
});
