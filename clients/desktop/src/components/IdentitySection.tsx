import { useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { Keypair } from '@cumulusvpn/core';
import {
  checkRestore,
  codeOf,
  copyText,
  markRecoveryKeySaved,
  recoveryKeyFor,
  shortCode,
  switchIdentity,
} from '../lib/identity.js';
import { loadOrCreateKeypair } from '../lib/storage.js';

interface Props {
  /** Open with the recovery key already showing (the "save your key" nudge). */
  readonly revealKey?: boolean;
  /** Switch this computer to `next`; injectable for tests. */
  readonly onSwitch?: (next: Keypair) => Promise<void>;
}

type Step =
  | { readonly kind: 'idle' }
  | { readonly kind: 'restore' }
  | { readonly kind: 'confirm'; readonly keypair: Keypair; readonly code: string };

/**
 * Settings → Identity: show and copy the recovery key, or restore another
 * identity from one (mirrors the mobile app's IdentitySection).
 *
 * Restoring changes WHICH identity this computer runs, so it asks first and
 * names both codes: Premium paid to the current key stays with that key, and
 * without its recovery key a stray click cannot be undone.
 */
export function IdentitySection({
  revealKey = false,
  onSwitch = switchIdentity,
}: Props): JSX.Element {
  const keypair = useMemo(() => loadOrCreateKeypair(), []);
  const code = useMemo(() => codeOf(keypair), [keypair]);
  const recoveryKey = useMemo(() => recoveryKeyFor(keypair), [keypair]);
  const [showKey, setShowKey] = useState(revealKey);
  const [copied, setCopied] = useState(false);
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (revealKey) {
      ref.current?.scrollIntoView?.({ block: 'center' });
    }
  }, [revealKey]);

  const reset = (): void => {
    setStep({ kind: 'idle' });
    setInput('');
    setError(null);
  };

  const onCopy = async (): Promise<void> => {
    if (await copyText(recoveryKey)) {
      markRecoveryKeySaved(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
  };

  const review = (): void => {
    const check = checkRestore(input, keypair);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    setError(null);
    setStep({ kind: 'confirm', keypair: check.keypair, code: check.code });
  };

  const restore = async (next: Keypair): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      // Reloads the window on success, so there is nothing to reset after it.
      await onSwitch(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="setrow st-wrap id-wrap" ref={ref}>
      <div className="st-note">
        Your Premium belongs to your key, not to this computer. Save your recovery key to restore it
        on any phone, tablet or computer — it works best on one device at a time, or on devices
        connected to different countries.
      </div>

      {showKey && recoveryKey && (
        <>
          <div className="id-key">{recoveryKey}</div>
          <div className="st-warn">
            Anyone with this key gets this identity and its Premium. Keep it private — a password
            manager is a good place.
          </div>
        </>
      )}

      <div className="id-btns">
        {recoveryKey && (
          <button
            type="button"
            className="st-addbtn"
            aria-expanded={showKey}
            onClick={() => setShowKey((v) => !v)}
          >
            {showKey ? 'Hide recovery key' : 'Show recovery key'}
          </button>
        )}
        {showKey && recoveryKey && (
          <button type="button" className="st-addbtn" onClick={() => void onCopy()}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
        {step.kind === 'idle' && (
          <button
            type="button"
            className="st-addbtn"
            onClick={() => {
              reset();
              setStep({ kind: 'restore' });
            }}
          >
            Restore from recovery key
          </button>
        )}
      </div>

      {step.kind === 'restore' && (
        <>
          <textarea
            className="st-input id-input"
            rows={3}
            value={input}
            placeholder="CVPN-…"
            aria-label="Recovery key to restore"
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            onChange={(e) => {
              setInput(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (input.trim() !== '') {
                  review();
                }
              }
            }}
          />
          <div className="id-btns">
            <button
              type="button"
              className="st-addbtn id-primary"
              disabled={input.trim() === ''}
              onClick={review}
            >
              Continue
            </button>
            <button type="button" className="st-addbtn" onClick={reset}>
              Cancel
            </button>
          </div>
        </>
      )}

      {step.kind === 'confirm' && (
        <div className="id-confirm" role="alert">
          <div className="setlabel">Restore this identity?</div>
          <div className="st-warn">
            This computer switches to identity {shortCode(step.code)} and the VPN disconnects.
            {code
              ? ` Premium paid to the current identity (${shortCode(code)}) stays with it — save its recovery key first if it has any.`
              : ''}
          </div>
          <div className="id-btns">
            <button
              type="button"
              className="st-addbtn id-primary"
              disabled={busy}
              onClick={() => void restore(step.keypair)}
            >
              {busy ? 'Restoring…' : 'Restore'}
            </button>
            <button type="button" className="st-addbtn" disabled={busy} onClick={reset}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="st-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
