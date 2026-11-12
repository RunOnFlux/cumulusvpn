/**
 * Local persistence for the identity keypair, last-selected country, and the
 * tunnel settings that are read at connect time (split tunneling, DNS).
 *
 * The WireGuard keypair is the identity: it enrolls at many gateways, and
 * entitlement follows the key on the chain (see `docs/05-clients.md`), not the
 * computer — the recovery key (Settings → Identity) carries it to another
 * device. Kept in the webview's `localStorage` by owner decision; the OS
 * keychain (macOS Keychain / Windows Credential Manager / libsecret) via a
 * Tauri command is the hardening path.
 */
import {
  EMPTY_POLICY,
  generateKeypair,
  parseDnsChoice,
  sanitizeSplitPolicy,
} from '@cumulusvpn/core';
import type { DnsChoice, GatewayInfo, Keypair, SplitPolicy } from '@cumulusvpn/core';

const KEYPAIR_KEY = 'cvpn.keypair.v1';
const COUNTRY_KEY = 'cvpn.country.v1';
const SPLIT_KEY = 'cvpn.split.v1';
const DNS_KEY = 'cvpn.dns.v1';
const FLEET_KEY = 'cvpn.fleet.v1';

function safeGet(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    /* storage unavailable (private mode / headless) — session-only is fine */
  }
}

/** The persisted device keypair, or null when there is none (or it's corrupt). */
export function loadStoredKeypair(): Keypair | null {
  const raw = safeGet(KEYPAIR_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Keypair>;
    if (
      typeof parsed.publicKey === 'string' &&
      typeof parsed.privateKey === 'string' &&
      parsed.publicKey.length > 0 &&
      parsed.privateKey.length > 0
    ) {
      return { publicKey: parsed.publicKey, privateKey: parsed.privateKey };
    }
  } catch {
    /* corrupt */
  }
  return null;
}

/** Load the persisted device keypair, generating and storing one on first run. */
export function loadOrCreateKeypair(): Keypair {
  const stored = loadStoredKeypair();
  if (stored) {
    return stored;
  }
  const fresh = generateKeypair();
  saveKeypair(fresh);
  return fresh;
}

/** Make `keypair` this device's identity (e.g. one restored from a recovery key). */
export function saveKeypair(keypair: Keypair): void {
  safeSet(KEYPAIR_KEY, JSON.stringify(keypair));
}

/** Stored for an explicit "Automatic" pick (absent also means Automatic). */
const AUTOMATIC = 'auto';

/**
 * The last-picked location id (`DE`, or `DE:Frankfurt` for a city), or `null`
 * for Automatic — the default for a fresh install, as on mobile.
 */
export function loadSelectedCountry(): string | null {
  const v = safeGet(COUNTRY_KEY);
  return v === null || v === '' || v === AUTOMATIC ? null : v;
}

/** Persist the picked location id; `null` = Automatic. */
export function saveSelectedCountry(id: string | null): void {
  safeSet(COUNTRY_KEY, id ?? AUTOMATIC);
}

/**
 * Load the split-tunneling policy. Anything absent, corrupt or from a future
 * schema collapses to EMPTY_POLICY — full tunnel, never a partially-applied
 * policy (docs/17 §3.4). The rule list is sensitive (it fingerprints what the
 * user runs): it stays on-device and must never enter logs or support bundles.
 */
export function loadSplitPolicy(): SplitPolicy {
  const raw = safeGet(SPLIT_KEY);
  if (!raw) {
    return EMPTY_POLICY;
  }
  try {
    return sanitizeSplitPolicy(JSON.parse(raw));
  } catch {
    return EMPTY_POLICY;
  }
}

/** Persist the split-tunneling policy (device-local only, by design). */
export function saveSplitPolicy(policy: SplitPolicy): void {
  safeSet(SPLIT_KEY, JSON.stringify(policy));
}

/**
 * Load the DNS choice (Settings → DNS). Absent, corrupt, or an option a newer
 * build added all read as the default, so a bad value can never block a
 * connect. Device-local, like every tunnel setting.
 */
export function loadDnsChoice(): DnsChoice {
  return parseDnsChoice(safeGet(DNS_KEY));
}

/** Persist the DNS choice; it takes effect on the next connect. */
export function saveDnsChoice(choice: DnsChoice): void {
  safeSet(DNS_KEY, choice);
}

/**
 * The last good discovery, painted at launch so the picker is usable at once
 * while a live discovery refreshes it in the background — as on mobile
 * (`clients/mobile/src/state/storage.ts` `loadFleet`). Every gateway in it
 * passed signature verification when it was discovered, and connecting still
 * talks to the gateway itself, so a stale entry fails like a dead node would.
 */
export interface FleetCache {
  readonly gateways: readonly GatewayInfo[];
  readonly latencyByIp: Readonly<Record<string, number>>;
  readonly savedAt: number;
}

/** Older than this, a snapshot is more misleading than useful: skip it. */
export const FLEET_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function loadFleetCache(now: number = Date.now()): FleetCache | null {
  const raw = safeGet(FLEET_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<FleetCache>;
    if (
      !Array.isArray(parsed.gateways) ||
      parsed.gateways.length === 0 ||
      typeof parsed.savedAt !== 'number' ||
      now - parsed.savedAt > FLEET_CACHE_MAX_AGE_MS ||
      typeof parsed.latencyByIp !== 'object' ||
      parsed.latencyByIp === null
    ) {
      return null;
    }
    return parsed as FleetCache;
  } catch {
    return null;
  }
}

export function saveFleetCache(
  gateways: readonly GatewayInfo[],
  latencyByIp: Readonly<Record<string, number>>,
  savedAt: number = Date.now(),
): void {
  const blob: FleetCache = { gateways, latencyByIp, savedAt };
  safeSet(FLEET_KEY, JSON.stringify(blob));
}
