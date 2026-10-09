/**
 * Cloudflare Worker for vpn.cumulusvpn.com.
 *
 * Serves the built static site (via the ASSETS binding) AND proxies the web
 * app's gateway calls so an https page can reach the plain-http gateway control
 * API without a mixed-content block:
 *
 *   GET/POST  /gw/<ip>:<port>/<path>   →   http://<ip>:<port>/<path>
 *
 * The gateway signs its response bodies, and this is same-origin, so the browser
 * can read the signature headers and verify as usual. The body is relayed
 * byte-for-byte: re-encoding it would break the signature.
 *
 * IMPORTANT — why raw TCP, not fetch(): a Worker's fetch() refuses a bare IP
 * literal (Cloudflare error 1003, "direct IP access not allowed") and can only
 * reach Cloudflare's supported ports, which 51821 and 16127 are not. Every
 * proxied call came back `403 error code: 1003`, so the page told every visitor
 * "no live gateway" while the fleet was healthy. The `cloudflare:sockets`
 * connect() API has neither restriction, so we speak minimal HTTP/1.0 over a
 * raw socket — the same fix the fleet dashboard needed (clients/dashboard).
 *
 * SSRF guard: only the gateway control port + the Flux node port, and only
 * public IPv4 targets, so it can't be used as an open relay to arbitrary hosts
 * or internal addresses. (A tighter follow-up: allowlist IPs from the signed
 * directory.)
 */

import { connect } from 'cloudflare:sockets';

const ALLOWED_PORTS = new Set(['51821', '16127']);

// A healthy gateway answers in well under 2s, even across continents. Discovery
// waits for its slowest probe, so a dead gateway must not hold the page for
// long — and the browser gives up at 12s anyway (fetchSigned in @cumulusvpn/core).
const UPSTREAM_TIMEOUT_MS = 5_000;

// Enroll bodies are capped at 4 KiB gateway-side and replies are ~1 KiB; a Flux
// node's /apps/location list is a few KiB. The caps stop a misbehaving peer
// from streaming forever.
const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;

// The only upstream headers the client reads (besides Content-Type). Nothing
// else is relayed: the target is an operator-run host, and whatever we pass on
// is served from this origin — which holds the user's WireGuard private key.
const SIGNATURE_HEADERS = ['x-cvpn-signature', 'x-cvpn-sign-pubkey'];

/** True only for a routable public IPv4 literal (blocks private / loopback /
 *  link-local / CGNAT / reserved). Rejects leading-zero octets, which
 *  `fetch`/WHATWG-URL would otherwise parse as OCTAL (e.g. "012" → 10), letting
 *  a padded form slip a private address past a decimal check. */
function isPublicIPv4(host) {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return false;
    if (p.length > 1 && p[0] === '0') return false; // no octal / zero-padded octets
  }
  const o = parts.map(Number);
  if (o.some((n) => n > 255)) return false;
  const [a, b] = o;
  if (a === 0 || a === 10 || a === 127) return false; // this-network / private / loopback
  if (a === 169 && b === 254) return false; // link-local
  if (a === 172 && b >= 16 && b <= 31) return false; // private
  if (a === 192 && b === 168) return false; // private
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT (100.64/10)
  if (a === 192 && b === 0 && o[2] === 0) return false; // 192.0.0/24 (IETF)
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking (198.18/15)
  if (a >= 224) return false; // multicast (224/4) + reserved (240/4) + 255.255.255.255
  return true;
}

/** Index of the CRLF-CRLF that ends the HTTP header block, or -1. */
function headerEnd(buf) {
  for (let i = 0; i + 3 < buf.length; i++) {
    if (buf[i] === 13 && buf[i + 1] === 10 && buf[i + 2] === 13 && buf[i + 3] === 10) {
      return i;
    }
  }
  return -1;
}

/**
 * Send one request and read the whole reply. HTTP/1.0 on purpose: a server
 * must not answer it chunked, so the body is either Content-Length framed or
 * runs to EOF — no chunked decoder needed (Go's net/http and FluxOS both comply).
 */
async function exchange(socket, request) {
  const writer = socket.writable.getWriter();
  await writer.write(request);
  writer.releaseLock();

  const reader = socket.readable.getReader();
  const chunks = [];
  let total = 0;
  let want = -1; // header + body length, once Content-Length is known
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    total += value.length;
    if (total > MAX_RESPONSE_BYTES) throw new Error('response too large');
    if (want < 0) {
      const buf = concat(chunks, total);
      const sep = headerEnd(buf);
      if (sep >= 0) {
        const cl = /^content-length:\s*(\d+)\s*$/im.exec(
          new TextDecoder().decode(buf.subarray(0, sep)),
        );
        if (cl) want = sep + 4 + Number(cl[1]);
      }
    }
    if (want >= 0 && total >= want) break;
  }
  return concat(chunks, total);
}

function concat(chunks, total) {
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.length;
  }
  return buf;
}

/** Turn raw HTTP reply bytes into a Response for the browser; throws if malformed. */
function toResponse(raw) {
  const sep = headerEnd(raw);
  if (sep < 0) throw new Error('no header terminator');
  const lines = new TextDecoder().decode(raw.subarray(0, sep)).split('\r\n');
  const status = /^HTTP\/1\.[01] (\d{3})\b/.exec(lines[0]);
  if (!status) throw new Error('bad status line');
  const fields = new Map();
  for (const line of lines.slice(1)) {
    const i = line.indexOf(':');
    if (i > 0) fields.set(line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim());
  }
  if (fields.has('transfer-encoding')) throw new Error('unexpected transfer-encoding');

  let body = raw.subarray(sep + 4);
  if (fields.has('content-length')) {
    const len = Number(fields.get('content-length'));
    if (!Number.isInteger(len) || body.length < len) throw new Error('truncated body');
    body = body.subarray(0, len);
  }

  const type = fields.get('content-type') ?? '';
  const headers = new Headers({
    // Never let an upstream make this origin render HTML or run script.
    'content-type': /^application\/json\b/i.test(type) ? type : 'text/plain; charset=utf-8',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
    'cache-control': 'no-store',
  });
  for (const name of SIGNATURE_HEADERS) {
    const v = fields.get(name);
    if (v) headers.set(name, v);
  }
  return new Response(body, { status: Number(status[1]), headers });
}

async function proxy(request, url) {
  const rest = url.pathname.slice('/gw/'.length);
  const slash = rest.indexOf('/');
  const authority = slash === -1 ? rest : rest.slice(0, slash);
  const path = (slash === -1 ? '/' : rest.slice(slash)) + url.search;
  const [host, port] = authority.split(':');

  if (!host || !port || !ALLOWED_PORTS.has(port) || !isPublicIPv4(host)) {
    return new Response('proxy target not allowed', { status: 403 });
  }
  if (request.method !== 'GET' && request.method !== 'POST') {
    return new Response('method not allowed', { status: 405, headers: { allow: 'GET, POST' } });
  }
  // WHATWG URL parsing percent-encodes these already; a raw socket has no such
  // safety net, so refuse anything that could split the request line.
  if (/[\x00-\x20\x7f]/.test(path)) {
    return new Response('bad path', { status: 400 });
  }

  let head = `${request.method} ${path} HTTP/1.0\r\nHost: ${host}:${port}\r\nAccept: application/json\r\n`;
  let body = new Uint8Array(0);
  if (request.method === 'POST') {
    body = new Uint8Array(await request.arrayBuffer());
    if (body.length > MAX_REQUEST_BYTES) {
      return new Response('request too large', { status: 413 });
    }
    const ct = request.headers.get('content-type');
    if (ct) head += `Content-Type: ${ct}\r\n`;
    head += `Content-Length: ${body.length}\r\n`;
  }
  const encoded = new TextEncoder().encode(`${head}\r\n`);
  const message = new Uint8Array(encoded.length + body.length);
  message.set(encoded);
  message.set(body, encoded.length);

  const socket = connect(
    { hostname: host, port: Number(port) },
    { secureTransport: 'off', allowHalfOpen: false },
  );
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), UPSTREAM_TIMEOUT_MS);
  });
  try {
    return toResponse(await Promise.race([exchange(socket, message), timeout]));
  } catch {
    return new Response('gateway unreachable', { status: 502 });
  } finally {
    clearTimeout(timer);
    // Not awaited: closing a socket whose connect is still pending waits for
    // that attempt to fail, which held a dead gateway's 502 past the browser's
    // 12s abort.
    socket.close().catch(() => {});
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/gw/')) {
      return proxy(request, url);
    }

    // Everything else: the static site (with SPA/hash-routing fallback).
    return env.ASSETS.fetch(request);
  },
};
