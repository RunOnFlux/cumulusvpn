import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { fetch as nativeFetch } from '@tauri-apps/plugin-http';
import { gatewayFetch } from './gatewayFetch';

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: vi.fn(),
  invoke: vi.fn(async () => undefined),
}));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));

const INFO = 'http://203.0.113.7:51821/v1/info';

/** The `frontend_log` lines written so far. */
function logged(): string[] {
  return vi
    .mocked(invoke)
    .mock.calls.filter(([cmd]) => cmd === 'frontend_log')
    .map(([, args]) => (args as { line: string }).line);
}

describe('gatewayFetch', () => {
  const webviewFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', webviewFetch);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  // Gateways send no CORS headers, so a webview fetch of their control API
  // always rejects; in the app every call must go through the native client.
  it('in Tauri, sends gateway calls natively and never through the webview', async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(nativeFetch).mockResolvedValue(new Response('{}', { status: 200 }));

    const res = await gatewayFetch()(INFO);

    expect(res.status).toBe(200);
    expect(nativeFetch).toHaveBeenCalledWith(INFO, undefined);
    expect(webviewFetch).not.toHaveBeenCalled();
    expect(logged()).toEqual([
      expect.stringMatching(/^fetch\[native\] .*\/v1\/info -> 200 in \d+ ms$/),
    ]);
  });

  it('logs a failed request with its error and rethrows it', async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(nativeFetch).mockRejectedValue(new TypeError('error sending request'));

    await expect(gatewayFetch()(INFO)).rejects.toThrow('error sending request');
    expect(logged()).toEqual([
      expect.stringMatching(/^fetch\[native\] .* -> TypeError: error sending request in \d+ ms$/),
    ]);
  });

  it('failures-only logging: a success is counted but not logged, a failure is both', async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    const outcomes: boolean[] = [];
    const f = gatewayFetch(undefined, { failuresOnly: true, onOutcome: (ok) => outcomes.push(ok) });

    vi.mocked(nativeFetch).mockResolvedValueOnce(new Response('{}', { status: 200 }));
    await f(INFO);
    vi.mocked(nativeFetch).mockResolvedValueOnce(new Response('{}', { status: 503 }));
    await f(INFO);
    vi.mocked(nativeFetch).mockRejectedValueOnce(new Error('Request canceled'));
    await expect(f(INFO)).rejects.toThrow('Request canceled');

    expect(outcomes).toEqual([true, false, false]);
    expect(logged()).toEqual([
      expect.stringMatching(/\/v1\/info -> 503 in \d+ ms$/),
      expect.stringMatching(/\/v1\/info -> Error: Request canceled in \d+ ms$/),
    ]);
  });

  it('passes the request init (abort signal, method, body) through unchanged', async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(nativeFetch).mockResolvedValue(new Response('{}', { status: 200 }));
    const init = { method: 'POST', body: '{}', signal: new AbortController().signal };

    await gatewayFetch()(INFO, init);

    expect(nativeFetch).toHaveBeenCalledWith(INFO, init);
  });

  it('outside Tauri (browser demo), uses the global fetch', async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    webviewFetch.mockResolvedValue(new Response('{}', { status: 200 }));

    await gatewayFetch()(INFO);

    expect(webviewFetch).toHaveBeenCalledWith(INFO, undefined);
    expect(nativeFetch).not.toHaveBeenCalled();
  });

  it('an override replaces the transport and is still logged', async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    const override = vi.fn(async () => new Response('{}', { status: 503 }));

    await gatewayFetch(override as unknown as typeof fetch)(INFO);

    expect(override).toHaveBeenCalledWith(INFO, undefined);
    expect(nativeFetch).not.toHaveBeenCalled();
    expect(logged()).toEqual([
      expect.stringMatching(/^fetch\[override\] .*\/v1\/info -> 503 in \d+ ms$/),
    ]);
  });
});
