import { describe, expect, it, vi } from 'vitest';
import { routedFetch, routesNatively } from './nativeFetch';

describe('routesNatively', () => {
  it('sends the fleet through Rust', () => {
    expect(routesNatively('http://92.99.224.241:51821/v1/info')).toBe(true);
    expect(routesNatively('http://9.9.9.9:16127/apps/location/cumulusvpnde')).toBe(true);
    expect(routesNatively('https://api.runonflux.io/apps/location/cumulusvpnde')).toBe(true);
  });

  it('keeps Tauri IPC, the dev server and junk on the web view', () => {
    expect(routesNatively('ipc://localhost/plugin%3Ahttp%7Cfetch')).toBe(false);
    expect(routesNatively('http://ipc.localhost/connect')).toBe(false);
    expect(routesNatively('http://tauri.localhost/index.html')).toBe(false);
    expect(routesNatively('http://localhost:1420/src/main.tsx')).toBe(false);
    expect(routesNatively('http://127.0.0.1:1420/')).toBe(false);
    expect(routesNatively('/relative')).toBe(false);
    expect(routesNatively('data:text/plain,hi')).toBe(false);
  });
});

describe('routedFetch', () => {
  it('dispatches by URL, passing the request through unchanged', async () => {
    const web = vi.fn(async () => new Response('web'));
    const native = vi.fn(async () => new Response('native'));
    const f = routedFetch(web as unknown as typeof fetch, native as unknown as typeof fetch);
    const init = { method: 'POST', body: '{}' };

    expect(await (await f('http://1.2.3.4:51821/v1/enroll', init)).text()).toBe('native');
    expect(native).toHaveBeenCalledWith('http://1.2.3.4:51821/v1/enroll', init);

    expect(await (await f(new URL('http://localhost:1420/x'))).text()).toBe('web');
    expect(await (await f(new Request('https://api.runonflux.io/apps'))).text()).toBe('native');
    expect(web).toHaveBeenCalledTimes(1);
    expect(native).toHaveBeenCalledTimes(2);
  });
});
