import { describe, expect, it } from 'vitest';
import bundled from '../directory.bundled.json';
import { resolveDirectory } from './directory';

const bundledJson = JSON.stringify(bundled);

describe('resolveDirectory', () => {
  it('uses the verified live copy when the fetch succeeds', async () => {
    const fetchImpl: typeof fetch = async () => new Response(bundledJson, { status: 200 });
    const resolved = await resolveDirectory(fetchImpl);
    expect(resolved.source).toBe('live');
    expect(resolved.verified).toBe(true);
    expect(resolved.directory.version).toBe(1);
  });

  it('falls back to the bundled snapshot when the network is offline', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error('offline');
    };
    const resolved = await resolveDirectory(fetchImpl);
    expect(resolved.source).toBe('bundled');
    expect(resolved.verified).toBe(true);
    expect(resolved.directory.specs.length).toBeGreaterThan(0);
  });

  it('falls back to the bundle when the live response is not ok', async () => {
    const fetchImpl: typeof fetch = async () => new Response('nope', { status: 502 });
    const resolved = await resolveDirectory(fetchImpl);
    expect(resolved.source).toBe('bundled');
    expect(resolved.verified).toBe(true);
  });

  it('discards a live copy whose signature does not verify', async () => {
    const tampered = { ...bundled, payment_address: 'tamperedADDRESS' };
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify(tampered), { status: 200 });
    const resolved = await resolveDirectory(fetchImpl);
    // The unverifiable live copy is dropped in favour of the trusted bundle.
    expect(resolved.source).toBe('bundled');
    expect(resolved.verified).toBe(true);
    expect(resolved.directory.payment_address).not.toBe('tamperedADDRESS');
  });
});
