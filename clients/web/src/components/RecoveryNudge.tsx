import { useMemo, useState } from 'react';
import type { Keypair } from '@cumulusvpn/core';
import { useI18n } from '../hooks/useLocale';
import {
  codeOf,
  dismissNudge,
  markRecoveryKeySaved,
  nudgeDismissed,
  recoveryKeyFor,
  recoveryKeySaved,
} from '../lib/recoveryKey';
import type { NudgeContext } from '../lib/recoveryKey';
import { CopyField } from './CopyField';

interface RecoveryNudgeProps {
  /** This browser's identity. */
  readonly keypair: Keypair;
  /** The payment code the page is crediting — may be another device's (`?code=`, typed). */
  readonly code: string;
  readonly context: NudgeContext;
}

/**
 * A gentle "save your recovery key" reminder where Premium is bought: Premium
 * belongs to the key, and in a browser the key lives in site storage that a
 * "clear browsing data" wipes. Dismissible for the session; it stops for good
 * once this identity's key has been copied.
 *
 * When the page is paying for ANOTHER device's code, this browser's key is the
 * wrong one to offer, so it only points at that device's own settings.
 */
export function RecoveryNudge({ keypair, code, context }: RecoveryNudgeProps) {
  const { t } = useI18n();
  const ownCode = useMemo(() => codeOf(keypair), [keypair]);
  const recoveryKey = useMemo(() => recoveryKeyFor(keypair), [keypair]);
  // Read once: copying the key from this nudge must not snatch it off screen.
  const [hidden, setHidden] = useState(
    () => nudgeDismissed(context) || (code === ownCode && recoveryKeySaved(ownCode)),
  );
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);

  const own = code !== '' && code === ownCode;
  if (hidden || code === '' || (own && recoveryKey === '')) {
    return null;
  }

  return (
    <div className="banner info nudge" role="note">
      <p>{own ? t('recovery_nudge') : t('recovery_nudge_other')}</p>
      {own && showKey ? (
        <>
          <CopyField
            label={t('identity_key_label')}
            value={recoveryKey}
            onCopied={() => {
              markRecoveryKeySaved(ownCode);
              setCopied(true);
            }}
          />
          <p className="ident-warn">{t('identity_key_warn')}</p>
        </>
      ) : null}
      <div className="btn-row">
        {own && !showKey ? (
          <button type="button" className="btn ghost sm" onClick={() => setShowKey(true)}>
            {t('identity_show_key')}
          </button>
        ) : null}
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => {
            dismissNudge(context);
            setHidden(true);
          }}
        >
          {copied ? t('recovery_nudge_done') : t('recovery_nudge_dismiss')}
        </button>
      </div>
    </div>
  );
}
