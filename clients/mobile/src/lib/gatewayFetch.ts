/**
 * A `fetch` for gateway control-API calls that goes through the iOS tunnel
 * extension instead of the app's own network stack.
 *
 * While the kill switch HOLDS a session (useVpn), iOS `includeAllNetworks`
 * blocks the app's own requests along with everything else — including the
 * enroll on the next node that would end the hold. The extension's sockets are
 * exempt, so those requests are relayed through it
 * (`CumulusTunnel.gatewayFetch`). Core `fetchSigned` still verifies every
 * response's signature, so the relay is not trusted with anything.
 *
 * Only what the control API uses is supported: a string body, `status`,
 * `ok`, `headers.get`, `arrayBuffer`, `text` and `json`.
 */
import type { FetchImpl } from '@cumulusvpn/core';
import type { GatewayFetchResponse } from '../native/CumulusTunnel';

/** The native relay, as `CumulusTunnel.gatewayFetch` is typed. */
export type GatewayRelay = (
  url: string,
  method: string,
  headers: Readonly<Record<string, string>>,
  body: string | null,
) => Promise<GatewayFetchResponse>;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Standard base64 (with padding) of `bytes`. */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    const n = (a << 16) | (b << 8) | c;
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!;
    out += i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63]! : '=';
    out += i + 2 < bytes.length ? ALPHABET[n & 63]! : '=';
  }
  return out;
}

/** Bytes of standard base64 `text` (padding optional, whitespace ignored). */
export function base64ToBytes(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let o = 0;
  for (const ch of clean) {
    value = (value << 6) | ALPHABET.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (value >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

/** UTF-8 bytes of `text` (React Native's types carry no TextEncoder). */
export function utf8Encode(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) {
      out.push(cp);
    } else if (cp < 0x800) {
      out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    } else if (cp < 0x10000) {
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    } else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 63),
        0x80 | ((cp >> 6) & 63),
        0x80 | (cp & 63),
      );
    }
  }
  return Uint8Array.from(out);
}

/** Text of UTF-8 `bytes`; malformed sequences become U+FFFD. */
export function utf8Decode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i]!;
    const len = b < 0x80 ? 1 : b >> 5 === 6 ? 2 : b >> 4 === 14 ? 3 : b >> 3 === 30 ? 4 : 0;
    if (len === 0 || i + len > bytes.length) {
      out += '\uFFFD';
      i += 1;
      continue;
    }
    let cp = len === 1 ? b : b & (0xff >> (len + 1));
    for (let k = 1; k < len; k += 1) {
      cp = (cp << 6) | (bytes[i + k]! & 63);
    }
    out += String.fromCodePoint(cp);
    i += len;
  }
  return out;
}

function headerRecord(headers: RequestInit['headers']): Record<string, string> {
  if (!headers) {
    return {};
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers.map(([k, v]) => [k, v] as const));
  }
  if (typeof (headers as Headers).forEach === 'function' && !(Symbol.iterator in Object(headers))) {
    const out: Record<string, string> = {};
    (headers as Headers).forEach((v, k) => {
      out[k] = v;
    });
    return out;
  }
  return { ...(headers as Record<string, string>) };
}

/** Wrap `relay` as a `fetch` for core's control-API calls. */
export function relayFetch(relay: GatewayRelay): FetchImpl {
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (init?.signal?.aborted) {
      throw new Error('aborted');
    }
    if (init?.body != null && typeof init.body !== 'string') {
      throw new Error('gatewayFetch: only string bodies are supported');
    }
    const body = typeof init?.body === 'string' ? bytesToBase64(utf8Encode(init.body)) : null;
    const res = await relay(url, init?.method ?? 'GET', headerRecord(init?.headers), body);
    const bytes = base64ToBytes(res.body);
    const lower = new Map(Object.entries(res.headers).map(([k, v]) => [k.toLowerCase(), v]));
    const text = (): string => utf8Decode(bytes);
    const response = {
      status: res.status,
      ok: res.status >= 200 && res.status < 300,
      headers: { get: (name: string): string | null => lower.get(name.toLowerCase()) ?? null },
      arrayBuffer: async (): Promise<ArrayBuffer> =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      text: async (): Promise<string> => text(),
      json: async (): Promise<unknown> => JSON.parse(text()),
    };
    return response as unknown as Response;
  };
  return impl as FetchImpl;
}
