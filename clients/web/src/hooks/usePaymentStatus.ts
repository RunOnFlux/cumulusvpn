import { useEffect, useState } from 'react';
import { paymentStatus } from '@cumulusvpn/core';
import type { BridgePayment } from '@cumulusvpn/core';
import { BRIDGE_URL, PAY_CHECKOUT_STARTED_STORAGE_KEY } from '../config';

const POLL_MS = 3_000;

/** Clock-skew grace when filtering rows against the checkout-start stamp. */
const SKEW_S = 120;

export type ActivationPhase = 'polling' | 'pending' | 'broadcast' | 'confirmed' | 'failed';

/** The unix-seconds stamp written when this browser last started a checkout. */
function checkoutStartedAt(): number {
  try {
    const raw = localStorage.getItem(PAY_CHECKOUT_STARTED_STORAGE_KEY);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * Poll the payments bridge for the payment created by THIS checkout while it
 * settles on-chain. Rows older than the checkout-start stamp are ignored —
 * for a renewing subscriber, last month's `confirmed` row is at the head of
 * the feed and would otherwise flash an instant, false "Confirmed!".
 */
export function usePaymentStatus(code: string, active: boolean): ActivationPhase {
  const [phase, setPhase] = useState<ActivationPhase>('polling');

  useEffect(() => {
    if (!active || !code) {
      return;
    }
    const since = checkoutStartedAt() - SKEW_S;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async (): Promise<void> => {
      try {
        const res = await paymentStatus(fetch.bind(window), code, { baseUrl: BRIDGE_URL });
        const latest: BridgePayment | undefined = res.payments.find((p) => p.created_at >= since);
        if (!stopped && latest) {
          setPhase(latest.status === 'failed' ? 'failed' : latest.status);
        }
        // No fresh payment row yet: the webhook may still be in flight — keep polling.
        if (!stopped && latest?.status !== 'confirmed') {
          timer = setTimeout(() => void tick(), POLL_MS);
        }
      } catch {
        if (!stopped) {
          timer = setTimeout(() => void tick(), POLL_MS);
        }
      }
    };
    void tick();

    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [code, active]);

  return phase;
}
