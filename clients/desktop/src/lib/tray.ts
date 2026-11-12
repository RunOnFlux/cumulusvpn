/**
 * What the menu-bar / tray menu shows, derived from the connection state.
 *
 * Pure, so the copy is tested without Tauri. `src/hooks/useTray.ts` pushes the
 * result to Rust (`set_tray`, see `src-tauri/src/tray.rs`), which only renders
 * it — all the wording lives here.
 */
import type { Phase } from '../hooks/useConnection.js';
import type { CountryOption } from './session.js';

export interface TrayCountry {
  readonly code: string;
  readonly label: string;
  readonly favorite: boolean;
}

/** Mirrors `TrayState` in src-tauri/src/tray.rs (camelCase over the wire). */
export interface TrayState {
  readonly phase: Phase;
  readonly headline: string;
  readonly detail: string | null;
  readonly stats: string | null;
  readonly selected: string | null;
  readonly killSwitch: boolean;
  /** Kill switch holding traffic after a drop (useConnection `blocked`). */
  readonly blocked: boolean;
  readonly countries: readonly TrayCountry[];
}

/** A click in the tray menu (the `tray-action` event payload). */
export type TrayAction =
  | { readonly kind: 'connect' }
  | { readonly kind: 'disconnect' }
  | { readonly kind: 'connectTo'; readonly code: string }
  | { readonly kind: 'toggleKillSwitch' };

export interface Speed {
  /** Bytes per second. */
  readonly down: number;
  readonly up: number;
}

export interface TrayInput {
  readonly phase: Phase;
  readonly selected: CountryOption | null;
  readonly exit: CountryOption | null;
  readonly multihop: boolean;
  readonly countries: readonly CountryOption[];
  readonly favorites: readonly string[];
  readonly killSwitch: boolean;
  readonly blocked?: boolean;
  readonly speed: Speed | null;
  readonly pingMs?: number | null;
  readonly connectedSince: number | null;
  readonly now: number;
}

/** Bits per second, the unit people compare against their plan. */
export function formatRate(bytesPerSec: number): string {
  const bits = Math.max(0, bytesPerSec) * 8;
  if (bits >= 1e9) {
    return `${(bits / 1e9).toFixed(2)} Gbit/s`;
  }
  if (bits >= 1e6) {
    return `${(bits / 1e6).toFixed(1)} Mbit/s`;
  }
  return `${Math.round(bits / 1e3)} kbit/s`;
}

/** `m:ss` under an hour, `h:mm:ss` after. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

function place(c: CountryOption): string {
  return `${c.flag} ${c.name}`;
}

function route(input: TrayInput): string {
  const { selected, exit, multihop } = input;
  if (!selected) {
    return '';
  }
  return multihop && exit && exit.code !== selected.code
    ? `${place(selected)} → ${place(exit)}`
    : place(selected);
}

export function trayStateOf(input: TrayInput): TrayState {
  const { phase, selected } = input;
  const where = route(input);

  let headline: string;
  switch (phase) {
    case 'loading':
      headline = 'Finding servers…';
      break;
    case 'connecting':
      headline = where ? `Connecting to ${where}…` : 'Connecting…';
      break;
    case 'connected':
      headline = where ? `Connected — ${where}` : 'Connected';
      break;
    case 'error':
      headline = input.blocked
        ? 'Blocked — kill switch on, reconnecting…'
        : 'Not connected — connection problem';
      break;
    default:
      headline = 'Not connected';
  }

  let detail: string | null = null;
  let stats: string | null = null;
  if (phase === 'connected' && selected) {
    const city = selected.city && selected.city !== selected.code ? selected.city : null;
    detail = [city, `Server ${selected.gatewayIp}`].filter(Boolean).join(' · ');
    const parts: string[] = [];
    if (input.speed) {
      parts.push(`↓ ${formatRate(input.speed.down)}`, `↑ ${formatRate(input.speed.up)}`);
    }
    if (input.pingMs != null) {
      parts.push(`${input.pingMs} ms`);
    }
    if (input.connectedSince) {
      parts.push(formatDuration(input.now - input.connectedSince));
    }
    stats = parts.length > 0 ? parts.join('  ·  ') : null;
  } else if (phase === 'idle' && selected) {
    detail = `Ready: ${place(selected)}`;
  }

  const favorites = new Set(input.favorites);
  // One row per country: the picker can list several cities of one country,
  // but "connect to Germany" is what a menu-bar click means.
  const seen = new Set<string>();
  const countries: TrayCountry[] = [];
  for (const c of input.countries) {
    if (seen.has(c.code)) {
      continue;
    }
    seen.add(c.code);
    countries.push({ code: c.code, label: place(c), favorite: favorites.has(c.code) });
  }

  return {
    phase,
    headline,
    detail,
    stats,
    selected: selected?.code ?? null,
    killSwitch: input.killSwitch,
    blocked: input.blocked === true,
    countries,
  };
}
