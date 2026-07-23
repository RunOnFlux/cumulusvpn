/**
 * Persistence seam — backed by AsyncStorage so device state survives restarts.
 *
 * The device keypair MUST persist so the same WireGuard identity (and therefore
 * the same on-chain entitlement) is reused every launch. Preferences, favorites
 * and a discovery cache persist too, so the app opens straight into a usable
 * state instead of re-discovering the whole fleet from cold every time.
 *
 * SECURITY (future hardening): the private key lives in AsyncStorage as plain
 * text. That already beats the previous in-memory stub (which minted a NEW key
 * every launch), but a production build should move it to the hardware-backed
 * Keychain / Keystore (`react-native-keychain`) and keep only a reference here.
 */
import type { GatewayInfo, Keypair, RouteStyle } from '@cumulusvpn/core';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RouteEndpoint } from '../lib/gateways';

/** Namespace every key so we never collide with other AsyncStorage users. */
const K = {
  keypair: 'cvpn:keypair',
  country: 'cvpn:country',
  routeStyle: 'cvpn:routeStyle',
  killSwitch: 'cvpn:killSwitch',
  nodeDiversity: 'cvpn:nodeDiversity',
  autoConnect: 'cvpn:autoConnect',
  favorites: 'cvpn:favorites',
  entryCountry: 'cvpn:entryCountry',
  exitCountry: 'cvpn:exitCountry',
  fleet: 'cvpn:fleet',
  activeRoute: 'cvpn:activeRoute',
  disclosure: 'cvpn:disclosureAck',
} as const;

/** The route of the live tunnel, persisted so a force-quit + relaunch can still
 *  show where it's connected (exit is null for single-hop). */
export interface PersistedRoute {
  readonly entry: RouteEndpoint;
  readonly exit: RouteEndpoint | null;
}

/** Persist the active route on connect (or clear it, null, on disconnect). */
export async function saveActiveRoute(route: PersistedRoute | null): Promise<void> {
  if (route) {
    await AsyncStorage.setItem(K.activeRoute, JSON.stringify(route));
  } else {
    await AsyncStorage.removeItem(K.activeRoute);
  }
}

/** The route of the last tunnel we brought up, for relaunch reconciliation. */
export async function loadActiveRoute(): Promise<PersistedRoute | null> {
  const raw = await AsyncStorage.getItem(K.activeRoute);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as PersistedRoute;
  } catch {
    return null;
  }
}

/**
 * Version of the pre-connection data disclosure the user last acknowledged.
 *
 * App Store Guideline 5.4 requires VPN apps to declare what data is collected
 * and how it is used on a screen shown BEFORE the service is used — a linked
 * policy is explicitly not sufficient. Bump this whenever the substance of that
 * declaration changes so the screen is shown again.
 */
export const DISCLOSURE_VERSION = '1';

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
  const raw = await AsyncStorage.getItem(K.keypair);
  return raw ? (JSON.parse(raw) as Keypair) : null;
}

/** Persist the device keypair. Future: move to the secure enclave / Keychain. */
export async function saveKeypair(kp: Keypair): Promise<void> {
  await AsyncStorage.setItem(K.keypair, JSON.stringify(kp));
}

/** Load the last selected country code, or null (= Automatic / nearest). */
export async function loadSelectedCountry(): Promise<string | null> {
  return AsyncStorage.getItem(K.country);
}

/** Persist the selected country code (null clears back to Automatic). */
export async function saveSelectedCountry(code: string | null): Promise<void> {
  if (code) {
    await AsyncStorage.setItem(K.country, code);
  } else {
    await AsyncStorage.removeItem(K.country);
  }
}

/** Load the persisted route style, defaulting to single-hop (multi-hop off). */
export async function loadRouteStyle(): Promise<RouteStyle> {
  const raw = await AsyncStorage.getItem(K.routeStyle);
  return raw && isRouteStyle(raw) ? raw : 'single';
}

/** Persist the selected route style (Fast vs multi-hop). */
export async function saveRouteStyle(style: RouteStyle): Promise<void> {
  await AsyncStorage.setItem(K.routeStyle, style);
}

/** Load the kill-switch preference (default off). */
export async function loadKillSwitch(): Promise<boolean> {
  return (await AsyncStorage.getItem(K.killSwitch)) === '1';
}

/** Persist the kill-switch preference. */
export async function saveKillSwitch(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(K.killSwitch, enabled ? '1' : '0');
}

/** Load the multi-hop node-diversity preference (default off). */
export async function loadNodeDiversity(): Promise<boolean> {
  return (await AsyncStorage.getItem(K.nodeDiversity)) === '1';
}

/** Persist the multi-hop node-diversity preference. */
export async function saveNodeDiversity(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(K.nodeDiversity, enabled ? '1' : '0');
}

/** Load the auto-connect-on-launch preference (default off). */
export async function loadAutoConnect(): Promise<boolean> {
  return (await AsyncStorage.getItem(K.autoConnect)) === '1';
}

/** Persist the auto-connect-on-launch preference. */
export async function saveAutoConnect(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(K.autoConnect, enabled ? '1' : '0');
}

/** True once the user has acknowledged the CURRENT disclosure version. */
export async function loadDisclosureAck(): Promise<boolean> {
  return (await AsyncStorage.getItem(K.disclosure)) === DISCLOSURE_VERSION;
}

/** Record that the user acknowledged the current disclosure version. */
export async function saveDisclosureAck(): Promise<void> {
  await AsyncStorage.setItem(K.disclosure, DISCLOSURE_VERSION);
}

/** Load the set of favorited (pinned) country codes. */
export async function loadFavorites(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(K.favorites);
  return raw ? raw.split(',').filter(Boolean) : [];
}

/** Persist the favorited country codes. */
export async function saveFavorites(codes: readonly string[]): Promise<void> {
  await AsyncStorage.setItem(K.favorites, codes.join(','));
}

/** Load the multi-hop entry country code, or null for auto-pick. */
export async function loadEntryCountry(): Promise<string | null> {
  return AsyncStorage.getItem(K.entryCountry);
}

/** Persist the multi-hop entry country code (null clears to auto-pick). */
export async function saveEntryCountry(code: string | null): Promise<void> {
  if (code) {
    await AsyncStorage.setItem(K.entryCountry, code);
  } else {
    await AsyncStorage.removeItem(K.entryCountry);
  }
}

/** Load the multi-hop exit country code, or null for auto-pick. */
export async function loadExitCountry(): Promise<string | null> {
  return AsyncStorage.getItem(K.exitCountry);
}

/** Persist the multi-hop exit country code (null clears to auto-pick). */
export async function saveExitCountry(code: string | null): Promise<void> {
  if (code) {
    await AsyncStorage.setItem(K.exitCountry, code);
  } else {
    await AsyncStorage.removeItem(K.exitCountry);
  }
}

/** A cached fleet snapshot: the last good discovery + its latency readings. */
export interface FleetCache {
  /** Flat, verified gateway list from the last successful discovery. */
  readonly gateways: readonly GatewayInfo[];
  /** Last measured RTT (ms) keyed by gateway IP, for instant dots on restore. */
  readonly latencyByIp: Readonly<Record<string, number>>;
  /** Unix-ms the snapshot was saved, for a staleness check. */
  readonly savedAt: number;
}

/**
 * Load the cached fleet, or null if none / unparseable. Serves as both an
 * instant first paint and a fallback when live discovery is slow or fails.
 */
export async function loadFleet(): Promise<FleetCache | null> {
  const raw = await AsyncStorage.getItem(K.fleet);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as FleetCache;
    // Guard against a shape change / corrupt blob.
    if (!Array.isArray(parsed.gateways) || parsed.gateways.length === 0) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Persist the latest good fleet snapshot (best-effort; failures are ignored). */
export async function saveFleet(
  gateways: readonly GatewayInfo[],
  latencyByIp: Readonly<Record<string, number>>,
  savedAt: number,
): Promise<void> {
  const blob: FleetCache = { gateways, latencyByIp, savedAt };
  await AsyncStorage.setItem(K.fleet, JSON.stringify(blob));
}
