import { useMemo, useState } from 'react';
import { paymentMemo } from '@cumulusvpn/core';
import type { Keypair } from '@cumulusvpn/core';
import { useI18n } from '../hooks/useLocale';
import type { MessageKey } from '../i18n';
import {
  checkRestore,
  codeOf,
  markRecoveryKeySaved,
  recoveryKeyFor,
  shortCode,
} from '../lib/recoveryKey';
import type { RestoreError } from '../lib/recoveryKey';
import { CopyField } from './CopyField';

interface IdentityPanelProps {
  readonly keypair: Keypair;
  /** True right after a restore, so the panel can confirm it landed. */
  readonly restored: boolean;
  readonly onRegenerate: () => void;
  readonly onRestore: (keypair: Keypair) => void;
}

const RESTORE_ERRORS: Record<RestoreError, MessageKey> = {
  format: 'identity_err_format',
  checksum: 'identity_err_checksum',
  version: 'identity_err_version',
  same: 'identity_err_same',
};

type Step =
  | { readonly kind: 'idle' }
  | { readonly kind: 'regenerate' }
  | { readonly kind: 'restore' }
  | { readonly kind: 'confirm'; readonly keypair: Keypair; readonly code: string };

/**
 * "This device's identity": the browser's key, its payment code, and the
 * recovery key that carries both to another browser, phone or computer
 * (mirrors the mobile app's IdentitySection).
 *
 * Both actions that change WHICH identity this browser runs — a new key, or a
 * restored one — ask first and name the codes involved: Premium paid to the
 * current key stays with that key, and without its recovery key a stray click
 * cannot be undone.
 */
export function IdentityPanel({ keypair, restored, onRegenerate, onRestore }: IdentityPanelProps) {
  const { t } = useI18n();
  const [showKey, setShowKey] = useState(false);
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [input, setInput] = useState('');
  const [error, setError] = useState<RestoreError | null>(null);

  const code = useMemo(() => codeOf(keypair), [keypair]);
  const recoveryKey = useMemo(() => recoveryKeyFor(keypair), [keypair]);
  const memo = useMemo(() => {
    try {
      return paymentMemo(keypair.publicKey);
    } catch {
      return '';
    }
  }, [keypair.publicKey]);
  const current = shortCode(code);

  const reset = (): void => {
    setStep({ kind: 'idle' });
    setInput('');
    setError(null);
  };

  const review = (): void => {
    const check = checkRestore(input, keypair);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setError(null);
    setStep({ kind: 'confirm', keypair: check.keypair, code: check.code });
  };

  const restore = (next: Keypair): void => {
    reset();
    setShowKey(false);
    onRestore(next);
  };

  const regenerate = (): void => {
    reset();
    setShowKey(false);
    onRegenerate();
  };

  const restoring = step.kind === 'restore' || step.kind === 'confirm';

  return (
    <section className="card ident">
      <div className="card-head">
        <h2>{t('connect_identity_title')}</h2>
        <button
          type="button"
          className="btn ghost sm"
          disabled={step.kind === 'regenerate'}
          onClick={() => {
            reset();
            setStep({ kind: 'regenerate' });
          }}
        >
          {t('connect_regenerate')}
        </button>
      </div>
      {restored ? <div className="banner info ident-banner">{t('identity_restored')}</div> : null}
      {step.kind === 'regenerate' ? (
        <div className="banner warn ident-banner" role="alert">
          <p>{t('identity_regen_confirm', { current })}</p>
          <div className="btn-row">
            <button type="button" className="btn amber sm" onClick={regenerate}>
              {t('identity_regen_cta')}
            </button>
            <button type="button" className="btn ghost sm" onClick={reset}>
              {t('identity_cancel')}
            </button>
          </div>
        </div>
      ) : null}
      <p className="muted-text">{t('connect_identity_note')}</p>
      <CopyField label={t('connect_field_public_key')} value={keypair.publicKey} />
      {memo ? <CopyField label={t('connect_field_payment_code')} value={memo} /> : null}
      {showKey && recoveryKey ? (
        <>
          <CopyField
            label={t('identity_key_label')}
            value={recoveryKey}
            onCopied={() => markRecoveryKeySaved(code)}
          />
          <p className="ident-warn">{t('identity_key_warn')}</p>
        </>
      ) : null}
      <div className="btn-row">
        {recoveryKey ? (
          <button
            type="button"
            className="btn ghost sm"
            aria-expanded={showKey}
            onClick={() => setShowKey((v) => !v)}
          >
            {showKey ? t('identity_hide_key') : t('identity_show_key')}
          </button>
        ) : null}
        {restoring ? null : (
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => {
              reset();
              setStep({ kind: 'restore' });
            }}
          >
            {t('identity_restore_open')}
          </button>
        )}
      </div>
      {step.kind === 'restore' ? (
        <div className="ident-restore">
          <textarea
            className="rk-input mono"
            rows={3}
            value={input}
            placeholder="CVPN-…"
            aria-label={t('identity_key_label')}
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
          <div className="btn-row">
            <button
              type="button"
              className="btn amber sm"
              disabled={input.trim() === ''}
              onClick={review}
            >
              {t('identity_continue')}
            </button>
            <button type="button" className="btn ghost sm" onClick={reset}>
              {t('identity_cancel')}
            </button>
          </div>
        </div>
      ) : null}
      {step.kind === 'confirm' ? (
        <div className="banner warn ident-banner" role="alert">
          <p>{t('identity_restore_confirm', { next: shortCode(step.code), current })}</p>
          <div className="btn-row">
            <button type="button" className="btn amber sm" onClick={() => restore(step.keypair)}>
              {t('identity_restore_cta')}
            </button>
            <button type="button" className="btn ghost sm" onClick={reset}>
              {t('identity_cancel')}
            </button>
          </div>
        </div>
      ) : null}
      {error ? (
        <div className="banner error ident-banner" role="alert">
          {t(RESTORE_ERRORS[error])}
        </div>
      ) : null}
    </section>
  );
}
