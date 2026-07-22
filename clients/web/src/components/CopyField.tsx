import { useState } from 'react';
import { useI18n } from '../hooks/useLocale';
import { copyText } from '../lib/download';

interface CopyFieldProps {
  readonly label: string;
  readonly value: string;
}

/** A labelled, monospaced value with an inline copy affordance (mockup `.field`). */
export function CopyField({ label, value }: CopyFieldProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const onCopy = async (): Promise<void> => {
    const ok = await copyText(value);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
  };

  return (
    <div className="field">
      <div className="lab">{label}</div>
      <div className="val">
        <span>{value}</span>
        <button type="button" className="cp" onClick={onCopy}>
          {copied ? t('common_copied') : t('common_copy')}
        </button>
      </div>
    </div>
  );
}
