/**
 * The recovery key on desktop: show it, restore from it, and nudge the user to
 * save it once there is Premium to lose (mirrors the mobile app's
 * `IdentitySection` and the web's identity panel).
 *
 * The identity IS the WireGuard keypair, and Premium is bound on-chain to the
 * payment code derived from its public key — so the recovery key (core
 * `encodeRecoveryKey`) carries the Premium with it. Restoring it on another
 * device moves that identity; it is not a second licence. Two devices on one
 * key work, but not on the same gateway at the same time (WireGuard keeps one
 * endpoint per key, so they knock each other off) — copy says "best on one
 * device at a time", never "on all your devices".
 */
import {
  decodeRecoveryKey,
  encodeRecoveryKey,
  InvalidRecoveryKeyError,
  paymentCode,
} from '@cumulusvpn/core';
import type { Keypair } from '@cumulusvpn/core';
import { saveKeypair } from './storage.js';
import { disconnect, status } from './tauri.js';
import type { TunnelStatus } from './tauri.js';

/** Payment code whose recovery key was last copied here (localStorage). */
const SAVED_KEY = 'cvpn.recovery.saved.v1';
/** "Not now" on the save-your-key nudge — for this app session only. */
const NUDGE_DISMISSED_KEY = 'cvpn.recoverynudge.dismissed.v1';
/** Set just before the reload that completes a restore, so the app can say so. */
const RESTORED_KEY = 'cvpn.identity.restored.v1';

/** `2J8Y…AwLD` — enough to tell two identities apart at a glance (as mobile shows it). */
export function shortCode(code: string): string {
  return code.length > 8 ? `${code.slice(0, 4)}…${code.slice(-4)}` : code;
}

/** The payment code (Device code) for `keypair`, or '' when it is malformed. */
export function codeOf(keypair: Keypair): string {
  try {
    return paymentCode(keypair.publicKey);
  } catch {
    return '';
  }
}

/** The recovery key for `keypair`, or '' when it is malformed. */
export function recoveryKeyFor(keypair: Keypair): string {
  try {
    return encodeRecoveryKey(keypair.privateKey);
  } catch {
    return '';
  }
}

export type RestoreCheck =
  | { readonly ok: true; readonly keypair: Keypair; readonly code: string }
  | { readonly ok: false; readonly message: string };

/**
 * Validate a typed or pasted recovery key against the identity this computer
 * already runs. Saves nothing: the caller confirms first.
 */
export function checkRestore(input: string, current: Keypair): RestoreCheck {
  let keypair: Keypair;
  try {
    keypair = decodeRecoveryKey(input);
  } catch (e) {
    if (e instanceof InvalidRecoveryKeyError && e.reason === 'checksum') {
      return { ok: false, message: 'That key has a typo. Check it character by character.' };
    }
    if (e instanceof InvalidRecoveryKeyError && e.reason === 'version') {
      return {
        ok: false,
        message: 'That key is from a newer CumulusVPN. Update the app, then try again.',
      };
    }
    return { ok: false, message: 'That doesn’t look like a CumulusVPN recovery key.' };
  }
  if (keypair.privateKey === current.privateKey) {
    return { ok: false, message: 'That is already this computer’s identity.' };
  }
  return { ok: true, keypair, code: codeOf(keypair) };
}

/** What `switchIdentity` needs from the outside world — injectable for tests. */
export interface SwitchDeps {
  readonly status: () => Promise<TunnelStatus>;
  readonly disconnect: () => Promise<TunnelStatus>;
  readonly save: (keypair: Keypair) => void;
  readonly reload: () => void;
}

const DEFAULT_DEPS: SwitchDeps = {
  status,
  disconnect,
  save: saveKeypair,
  reload: () => window.location.reload(),
};

export const DISCONNECT_FAILED =
  'Couldn’t disconnect the VPN, so the identity was not changed. Disconnect, then try again.';

/**
 * Make `next` this computer's identity: bring the tunnel down, store the key,
 * and reload so every part of the app starts over on it.
 *
 * The tunnel has to go first. It belongs to the helper daemon and outlives the
 * webview, and a relaunched app REATTACHES to a live session — so reloading
 * over a tunnel that is up would show the new identity sitting on a session
 * that runs on the old key. Mirrors the native `disconnect_if_active`: only an
 * active session is disconnected, because a disconnect also restores the
 * platform firewall default, which must not happen behind an idle app's back.
 * If it cannot be brought down, nothing changes.
 */
export async function switchIdentity(
  next: Keypair,
  deps: SwitchDeps = DEFAULT_DEPS,
): Promise<void> {
  let live: TunnelStatus | null;
  try {
    live = await deps.status();
  } catch {
    // The engine is unreachable: there is nothing we could tear down, and
    // nothing a relaunched app could reattach to either.
    live = null;
  }
  if (live && live.state !== 'down') {
    let after: TunnelStatus;
    try {
      after = await deps.disconnect();
    } catch {
      throw new Error(DISCONNECT_FAILED);
    }
    if (after.state !== 'down') {
      throw new Error(DISCONNECT_FAILED);
    }
  }
  deps.save(next);
  // Restoring proves the user holds this key: no need to nag them to save it.
  markRecoveryKeySaved(codeOf(next));
  try {
    sessionStorage.setItem(RESTORED_KEY, '1');
  } catch {
    /* storage unavailable — the restore still happened, only the notice is lost */
  }
  deps.reload();
}

/** Whether the last reload completed a restore (until {@link clearRestored}). */
export function wasRestored(): boolean {
  try {
    return sessionStorage.getItem(RESTORED_KEY) === '1';
  } catch {
    return false;
  }
}

export function clearRestored(): void {
  try {
    sessionStorage.removeItem(RESTORED_KEY);
  } catch {
    /* storage unavailable */
  }
}

/** Whether the recovery key for `code` was copied on this computer. */
export function recoveryKeySaved(code: string): boolean {
  if (!code) {
    return false;
  }
  try {
    return localStorage.getItem(SAVED_KEY) === code;
  } catch {
    return false;
  }
}

export function markRecoveryKeySaved(code: string): void {
  if (!code) {
    return;
  }
  try {
    localStorage.setItem(SAVED_KEY, code);
  } catch {
    /* storage unavailable — the nudge simply shows again */
  }
}

export function nudgeDismissed(): boolean {
  try {
    return sessionStorage.getItem(NUDGE_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissNudge(): void {
  try {
    sessionStorage.setItem(NUDGE_DISMISSED_KEY, '1');
  } catch {
    /* storage unavailable — dismissed until the window reloads */
  }
}

/** Copy `text` to the clipboard; resolves `true` on success. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
