import { useState } from 'react';
import { copyText } from '../lib/download';

interface CopyFieldProps {
  readonly label: string;
  readonly value: string;
}

/** A labelled, monospaced value with an inline copy affordance (mockup `.field`). */
export function CopyField({ label, value }: CopyFieldProps) {
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
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
