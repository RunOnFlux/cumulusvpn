import {
  base64ToBytes,
  bytesToBase64,
  relayFetch,
  utf8Decode,
  utf8Encode,
  type GatewayRelay,
} from './gatewayFetch';

describe('base64', () => {
  it('matches RFC 4648 test vectors in both directions', () => {
    const vectors: [string, string][] = [
      ['', ''],
      ['f', 'Zg=='],
      ['fo', 'Zm8='],
      ['foo', 'Zm9v'],
      ['foob', 'Zm9vYg=='],
      ['fooba', 'Zm9vYmE='],
      ['foobar', 'Zm9vYmFy'],
    ];
    for (const [text, b64] of vectors) {
      expect(bytesToBase64(utf8Encode(text))).toBe(b64);
      expect(utf8Decode(base64ToBytes(b64))).toBe(text);
    }
  });

  it('round-trips binary', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
  });
});

describe('utf8', () => {
  it('round-trips multi-byte text', () => {
    for (const text of ['ascii', 'Zürich', '東京', 'emoji 🔒']) {
      expect(utf8Decode(utf8Encode(text))).toBe(text);
    }
    expect(Array.from(utf8Encode('é'))).toEqual([0xc3, 0xa9]);
  });
});

describe('relayFetch', () => {
  it('sends the request through the relay and exposes what fetchSigned reads', async () => {
    const calls: Parameters<GatewayRelay>[] = [];
    const relay: GatewayRelay = async (...args) => {
      calls.push(args);
      return {
        status: 200,
        headers: { 'X-CVPN-Signature': 'sig', 'content-type': 'application/json' },
        body: bytesToBase64(utf8Encode('{"status":"success"}')),
      };
    };
    const fetchImpl = relayFetch(relay);
    const res = await fetchImpl('http://203.0.113.1:51821/v1/enroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"pubkey":"k"}',
    });

    expect(calls).toEqual([
      [
        'http://203.0.113.1:51821/v1/enroll',
        'POST',
        { 'Content-Type': 'application/json' },
        bytesToBase64(utf8Encode('{"pubkey":"k"}')),
      ],
    ]);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-cvpn-signature')).toBe('sig');
    expect(res.headers.get('missing')).toBeNull();
    expect(utf8Decode(new Uint8Array(await res.arrayBuffer()))).toBe('{"status":"success"}');
    expect(await res.json()).toEqual({ status: 'success' });
  });

  it('refuses an already-aborted request without calling the relay', async () => {
    const relay = jest.fn<ReturnType<GatewayRelay>, Parameters<GatewayRelay>>();
    const ctl = new AbortController();
    ctl.abort();
    await expect(relayFetch(relay)('http://x/', { signal: ctl.signal })).rejects.toThrow();
    expect(relay).not.toHaveBeenCalled();
  });
});
