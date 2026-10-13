import { useMemo, useState } from 'react';
import type { JSX } from 'react';
import type { Entitlement } from '../hooks/useConnection.js';
import {
  clearRestored,
  codeOf,
  dismissNudge,
  nudgeDismissed,
  recoveryKeySaved,
  wasRestored,
} from '../lib/identity.js';
import { loadOrCreateKeypair } from '../lib/storage.js';

interface Props {
  readonly entitlement: Entitlement | null;
  /** Open Settings with the recovery key showing. */
  readonly onShowKey: () => void;
}

/**
 * A gentle "save your recovery key" reminder once this key has Premium — the
 * moment losing the key starts to cost something (a reinstall, a new computer,
 * a wiped profile). Dismissible for the app session; gone for good once this
 * identity's key has been copied. Also confirms a restore after its reload.
 */
export function RecoveryNudge({ entitlement, onShowKey }: Props): JSX.Element | null {
  const code = useMemo(() => codeOf(loadOrCreateKeypair()), []);
  const [restored, setRestored] = useState(() => wasRestored());
  const [dismissed, setDismissed] = useState(() => nudgeDismissed());

  if (restored) {
    return (
      <div className="nudge" role="status">
        <div className="nudge-text">Restored. Premium on this identity shows within a minute.</div>
        <div className="nudge-btns">
          <button
            type="button"
            className="nudge-btn"
            onClick={() => {
              clearRestored();
              setRestored(false);
            }}
          >
            OK
          </button>
        </div>
      </div>
    );
  }

  // Read on every render: copying the key in Settings closes the sheet, and
  // that re-render is what should retire the reminder.
  if (entitlement?.tier !== 'premium' || dismissed || recoveryKeySaved(code)) {
    return null;
  }

  return (
    <div className="nudge" role="note">
      <div className="nudge-text">
        Save your recovery key so you don’t lose Premium if you reinstall or change computers.
      </div>
      <div className="nudge-btns">
        <button type="button" className="nudge-btn primary" onClick={onShowKey}>
          Show recovery key
        </button>
        <button
          type="button"
          className="nudge-btn"
          onClick={() => {
            dismissNudge();
            setDismissed(true);
          }}
        >
          Not now
        </button>
      </div>
    </div>
  );
}
