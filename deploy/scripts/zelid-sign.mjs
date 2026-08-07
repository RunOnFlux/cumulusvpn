// zelid-sign.mjs — Bitcoin-style signed message, the format FluxOS verifies for
// app registration/update ownership.
//
// The key is passed in as a value and used once; nothing here logs it, stores
// it, or returns anything derived from it beyond the signature itself.
//
// UNVERIFIED AGAINST A LIVE NODE: the public POST endpoints
// (/apps/calculateprice, /apps/appregister, /apps/appupdate) have been
// returning 504 for weeks, so this signing path has never round-tripped
// against FluxOS. The format below follows the standard message-signing scheme
// FluxOS uses, but treat the first broadcast as a test — check the response
// rather than assuming success.
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { base58, base64 } from '@scure/base';

const MAGIC = 'Bitcoin Signed Message:\n';

/** Bitcoin varint (compact size) — message lengths here are always < 0xfd*/
function varint(n) {
  if (n < 0xfd) return Uint8Array.of(n);
  if (n <= 0xffff) return Uint8Array.of(0xfd, n & 0xff, (n >> 8) & 0xff);
  return Uint8Array.of(0xfe, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff);
}

function concat(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** WIF → 32-byte private key + whether the pubkey is compressed. */
function decodeKey(key) {
  const raw = key.trim();
  // Raw hex (64 chars) is accepted too, assumed compressed.
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return { priv: Uint8Array.from(Buffer.from(raw, 'hex')), compressed: true };
  }
  const decoded = base58.decode(raw);
  const body = decoded.slice(0, decoded.length - 4); // strip checksum
  const priv = body.slice(1, 33); // strip version byte
  const compressed = body.length === 34 && body[33] === 0x01;
  return { priv, compressed };
}

/**
 * Sign `message` with a WIF (or hex) private key, returning the base64
 * signature FluxOS expects: 65 bytes of [recovery+27(+4 if compressed), r, s].
 */
export function signMessage(message, key) {
  const { priv, compressed } = decodeKey(key);
  const msg = new TextEncoder().encode(message);
  const magic = new TextEncoder().encode(MAGIC);
  const preimage = concat(varint(magic.length), magic, varint(msg.length), msg);
  const digest = sha256(sha256(preimage));

  // @noble/curves v2 returns raw bytes: `recovered` yields 65 = [recid, r, s].
  // `prehash: false` because we already double-SHA256'd the framed message —
  // letting the library hash again would sign the wrong digest.
  const recovered = secp256k1.sign(digest, priv, { prehash: false, format: 'recovered' });
  const recid = recovered[0];
  const rs = recovered.subarray(1);
  const header = 27 + recid + (compressed ? 4 : 0);
  return base64.encode(concat(Uint8Array.of(header), rs));
}
