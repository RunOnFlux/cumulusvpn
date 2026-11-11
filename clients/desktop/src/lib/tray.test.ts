import { describe, expect, it } from 'vitest';
import { formatDuration, formatRate, trayStateOf } from './tray';
import type { TrayInput } from './tray';
import type { CountryOption } from './session';

function country(code: string, name: string, flag: string, city = ''): CountryOption {
  return {
    code,
    name,
    flag,
    gatewayIp: `10.0.0.${code.charCodeAt(0)}`,
    city,
    load: 0.2,
    signPubKey: '',
  };
}

const DE = country('DE', 'Germany', '🇩🇪', 'Frankfurt');
const FR = country('FR', 'France', '🇫🇷', 'Paris');
const DE2 = country('DE', 'Germany', '🇩🇪', 'Berlin');

function input(over: Partial<TrayInput> = {}): TrayInput {
  return {
    phase: 'idle',
    selected: DE,
    exit: null,
    multihop: false,
    countries: [DE, DE2, FR],
    favorites: [],
    killSwitch: true,
    speed: null,
    connectedSince: null,
    now: 1_000_000,
    ...over,
  };
}

describe('formatRate', () => {
  it('reports bits per second with a sensible unit', () => {
    expect(formatRate(0)).toBe('0 kbit/s');
    expect(formatRate(1250)).toBe('10 kbit/s');
    expect(formatRate(1_562_500)).toBe('12.5 Mbit/s');
    expect(formatRate(156_250_000)).toBe('1.25 Gbit/s');
    expect(formatRate(-5)).toBe('0 kbit/s');
  });
});

describe('formatDuration', () => {
  it('uses m:ss under an hour and h:mm:ss after', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65_000)).toBe('1:05');
    expect(formatDuration(3_725_000)).toBe('1:02:05');
  });
});

describe('trayStateOf', () => {
  it('says where it is connected, with server, speed and session time', () => {
    const s = trayStateOf(
      input({
        phase: 'connected',
        speed: { down: 1_562_500, up: 125_000 },
        connectedSince: 1_000_000 - 65_000,
      }),
    );
    expect(s.headline).toBe('Connected — 🇩🇪 Germany');
    expect(s.detail).toBe(`Frankfurt · Server ${DE.gatewayIp}`);
    expect(s.stats).toBe('↓ 12.5 Mbit/s  ·  ↑ 1.0 Mbit/s  ·  1:05');
  });

  it('shows the multi-hop route', () => {
    const s = trayStateOf(input({ phase: 'connected', multihop: true, exit: FR }));
    expect(s.headline).toBe('Connected — 🇩🇪 Germany → 🇫🇷 France');
  });

  it('reads plainly when not connected', () => {
    expect(trayStateOf(input()).headline).toBe('Not connected');
    expect(trayStateOf(input()).detail).toBe('Ready: 🇩🇪 Germany');
    expect(trayStateOf(input()).stats).toBeNull();
    expect(trayStateOf(input({ phase: 'loading', selected: null })).headline).toBe(
      'Finding servers…',
    );
    expect(trayStateOf(input({ phase: 'connecting' })).headline).toBe('Connecting to 🇩🇪 Germany…');
    expect(trayStateOf(input({ phase: 'error' })).headline).toBe(
      'Not connected — connection problem',
    );
  });

  it('lists each country once and marks favourites', () => {
    const s = trayStateOf(input({ favorites: ['FR'] }));
    expect(s.countries).toEqual([
      { code: 'DE', label: '🇩🇪 Germany', favorite: false },
      { code: 'FR', label: '🇫🇷 France', favorite: true },
    ]);
    expect(s.selected).toBe('DE');
    expect(s.killSwitch).toBe(true);
  });
});
