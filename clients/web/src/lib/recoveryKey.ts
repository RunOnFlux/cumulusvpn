import {
  decodeRecoveryKey,
  encodeRecoveryKey,
  InvalidRecoveryKeyError,
  paymentCode,
} from '@cumulusvpn/core';
import type { Keypair } from '@cumulusvpn/core';
import { RECOVERY_KEY_SAVED_STORAGE_KEY, RECOVERY_NUDGE_DISMISSED_SESSION_KEY } from '../config';

/**
 * The recovery key is this browser's WireGuard private key in printable form
 * (core `encodeRecoveryKey`). Premium is bound on-chain to the payment code
 * derived from the matching public key, so whoever holds the recovery key holds
 * the Premium — and restoring it elsewhere moves that identity, it does not copy
 * a licence. One identity on two devices works, but not on the same gateway at
 * the same time: WireGuard keeps one endpoint per key, so they knock each other
 * off. Copy says "best on one device at a time", never "on all your devices".
 */

/** `2J8Y…AwLD` — enough to tell two identities apart at a glance (as the app shows it). */
export function shortCode(code: string): string {
  return code.length > 8 ? `${code.slice(0, 4)}…${code.slice(-4)}` : code;
}

/** The payment code for `keypair`, or '' when its stored public key is malformed. */
export function codeOf(keypair: Keypair): string {
  try {
    return paymentCode(keypair.publicKey);
  } catch {
    return '';
  }
}

/** The recovery key for `keypair`, or '' when its stored private key is malformed. */
export function recoveryKeyFor(keypair: Keypair): string {
  try {
    return encodeRecoveryKey(keypair.privateKey);
  } catch {
    return '';
  }
}

/** Why a typed recovery key cannot be restored here. */
export type RestoreError = 'format' | 'checksum' | 'version' | 'same';

export type RestoreCheck =
  | { readonly ok: true; readonly keypair: Keypair; readonly code: string }
  | { readonly ok: false; readonly error: RestoreError };

/**
 * Validate a typed or pasted recovery key against the identity this browser
 * already has. Nothing is saved: the caller confirms first, because replacing
 * a paid identity by a stray click is not recoverable without ITS key.
 */
export function checkRestore(input: string, current: Keypair): RestoreCheck {
  let keypair: Keypair;
  try {
    keypair = decodeRecoveryKey(input);
  } catch (e) {
    return { ok: false, error: e instanceof InvalidRecoveryKeyError ? e.reason : 'format' };
  }
  if (keypair.privateKey === current.privateKey) {
    return { ok: false, error: 'same' };
  }
  return { ok: true, keypair, code: codeOf(keypair) };
}

/** Whether the recovery key for `code` was copied in this browser. */
export function recoveryKeySaved(code: string): boolean {
  if (!code) {
    return false;
  }
  try {
    return localStorage.getItem(RECOVERY_KEY_SAVED_STORAGE_KEY) === code;
  } catch {
    return false;
  }
}

/** Remember that the recovery key for `code` was copied, so the nudge can stop. */
export function markRecoveryKeySaved(code: string): void {
  if (!code) {
    return;
  }
  try {
    localStorage.setItem(RECOVERY_KEY_SAVED_STORAGE_KEY, code);
  } catch {
    /* private mode — the nudge simply shows again next time */
  }
}

/** Where the save-your-recovery-key nudge is shown; each is dismissed separately. */
export type NudgeContext = 'upgrade' | 'confirmed';

export function nudgeDismissed(context: NudgeContext): boolean {
  try {
    return sessionStorage.getItem(`${RECOVERY_NUDGE_DISMISSED_SESSION_KEY}:${context}`) === '1';
  } catch {
    return false;
  }
}

export function dismissNudge(context: NudgeContext): void {
  try {
    sessionStorage.setItem(`${RECOVERY_NUDGE_DISMISSED_SESSION_KEY}:${context}`, '1');
  } catch {
    /* private mode — dismissal lasts for this page view */
  }
}
