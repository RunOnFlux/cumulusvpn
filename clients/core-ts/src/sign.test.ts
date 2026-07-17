import { ed25519 } from '@noble/curves/ed25519.js';
import { base64 } from '@scure/base';
import { describe, expect, it } from 'vitest';
import { verifySignedResponse } from './sign.js';

const encoder = new TextEncoder();

function fixture() {
  const secret = ed25519.utils.randomSecretKey();
  const pubB64 = base64.encode(ed25519.getPublicKey(secret));
  const body = encoder.encode('{"status":"success","data":{"tier":"free"}}');
  const sigB64 = base64.encode(ed25519.sign(body, secret));
  return { pubB64, body, sigB64 };
}

describe('verifySignedResponse', () => {
  it('verifies a genuine signature over the exact bytes', () => {
    const { pubB64, body, sigB64 } = fixture();
    expect(verifySignedResponse(body, sigB64, pubB64)).toBe(true);
  });

  it('rejects a signature over different bytes', () => {
    const { pubB64, sigB64 } = fixture();
    const tampered = encoder.encode('{"status":"success","data":{"tier":"premium"}}');
    expect(verifySignedResponse(tampered, sigB64, pubB64)).toBe(false);
  });

  it('rejects a signature from a different key', () => {
    const { body, sigB64 } = fixture();
    const other = base64.encode(ed25519.getPublicKey(ed25519.utils.randomSecretKey()));
    expect(verifySignedResponse(body, sigB64, other)).toBe(false);
  });

  it('returns false (never throws) on malformed base64', () => {
    const { body } = fixture();
    expect(verifySignedResponse(body, '!!!not-base64!!!', '###')).toBe(false);
  });
});
