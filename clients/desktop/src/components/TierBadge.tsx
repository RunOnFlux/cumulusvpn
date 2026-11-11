import type { JSX } from 'react';
import type { Entitlement } from '../hooks/useConnection.js';

interface Props {
  readonly entitlement: Entitlement | null;
  readonly onUpgrade: () => void;
}

function formatPaidUntil(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Tier pill + upgrade affordance. Desktop may link out to the payment page
 * freely (no store restrictions) — "Upgrade at cumulusvpn.com".
 */
export function TierBadge({ entitlement, onUpgrade }: Props): JSX.Element {
  const tier = entitlement?.tier ?? 'free';
  return (
    <div className="tier-row">
      <span className={`tier-pill ${tier}`}>{tier}</span>
      {tier === 'premium' && entitlement ? (
        <button className="paid" onClick={onUpgrade} title="Add more time">
          paid until {formatPaidUntil(entitlement.paidUntil)} · add time →
        </button>
      ) : (
        <button className="upgrade" onClick={onUpgrade}>
          Upgrade — card or FLUX →
        </button>
      )}
    </div>
  );
}
