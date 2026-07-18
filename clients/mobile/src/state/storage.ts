/**
 * Tiny persistence seam.
 *
 * The device keypair must survive app restarts so the same WireGuard identity
 * (and therefore the same on-chain entitlement) is reused every launch. In a
 * real build the private key belongs in the Keychain / Keystore (hardware-backed
 * where available); the discovery cache belongs in AsyncStorage / a file.
 *
 * POC: this is an in-memory stub with the final async signatures, so the rest
 * of the app is written against the real interface. Swap the body for
 * `react-native-keychain` + `@react-native-async-storage/async-storage`.
 */
import type { Keypair, RouteStyle } from '@cumulusvpn/core';

const mem = new Map<string, string>();

/** The route styles a user may persist (mirrors core `RouteStyle`). */
const ROUTE_STYLES: readonly RouteStyle[] = [
  'single',
  'multihop-same-country',
  'multihop-cross-jurisdiction',
];

function isRouteStyle(v: string): v is RouteStyle {
  return (ROUTE_STYLES as readonly string[]).includes(v);
}

/** Load the persisted device keypair, or null on first launch. */
export async function loadKeypair(): Promise<Keypair | null> {
  const raw = mem.get('keypair');
  return raw ? (JSON.parse(raw) as Keypair) : null;
}

/** Persist the device keypair. POC: use the secure enclave / Keychain instead. */
export async function saveKeypair(kp: Keypair): Promise<void> {
  mem.set('keypair', JSON.stringify(kp));
}

/** Load the last selected country code, or null. */
export async function loadSelectedCountry(): Promise<string | null> {
  return mem.get('country') ?? null;
}

/** Persist the selected country code. */
export async function saveSelectedCountry(code: string): Promise<void> {
  mem.set('country', code);
}

/** Load the persisted route style, defaulting to single-hop (multi-hop off). */
export async function loadRouteStyle(): Promise<RouteStyle> {
  const raw = mem.get('routeStyle');
  return raw && isRouteStyle(raw) ? raw : 'single';
}

/** Persist the selected route style (Fast vs multi-hop). */
export async function saveRouteStyle(style: RouteStyle): Promise<void> {
  mem.set('routeStyle', style);
}

/** Load the kill-switch preference (default off). */
export async function loadKillSwitch(): Promise<boolean> {
  return mem.get('killSwitch') === '1';
}

/** Persist the kill-switch preference. */
export async function saveKillSwitch(enabled: boolean): Promise<void> {
  mem.set('killSwitch', enabled ? '1' : '0');
}

/** Load the auto-connect-on-launch preference (default off). */
export async function loadAutoConnect(): Promise<boolean> {
  return mem.get('autoConnect') === '1';
}

/** Persist the auto-connect-on-launch preference. */
export async function saveAutoConnect(enabled: boolean): Promise<void> {
  mem.set('autoConnect', enabled ? '1' : '0');
}

/** Load the set of favorited (pinned) country codes. */
export async function loadFavorites(): Promise<string[]> {
  const raw = mem.get('favorites');
  return raw ? raw.split(',').filter(Boolean) : [];
}

/** Persist the favorited country codes. */
export async function saveFavorites(codes: readonly string[]): Promise<void> {
  mem.set('favorites', codes.join(','));
}

/** Load the multi-hop entry country code, or null for auto-pick. */
export async function loadEntryCountry(): Promise<string | null> {
  return mem.get('entryCountry') ?? null;
}

/** Persist the multi-hop entry country code (empty clears to auto-pick). */
export async function saveEntryCountry(code: string | null): Promise<void> {
  if (code) {
    mem.set('entryCountry', code);
  } else {
    mem.delete('entryCountry');
  }
}

/** Load the multi-hop exit country code, or null for auto-pick. */
export async function loadExitCountry(): Promise<string | null> {
  return mem.get('exitCountry') ?? null;
}

/** Persist the multi-hop exit country code (empty clears to auto-pick). */
export async function saveExitCountry(code: string | null): Promise<void> {
  if (code) {
    mem.set('exitCountry', code);
  } else {
    mem.delete('exitCountry');
  }
}
