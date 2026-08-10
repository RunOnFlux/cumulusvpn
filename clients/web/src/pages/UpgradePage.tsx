import { useMemo, useState } from 'react';
import { createStripeCheckout, paymentCode, walletDeepLink, MEMO_PREFIX } from '@cumulusvpn/core';
import type { Directory, Keypair, PaymentPlan } from '@cumulusvpn/core';
import {
  BRIDGE_URL,
  PAY_CHECKOUT_STARTED_STORAGE_KEY,
  PAY_CODE_OVERRIDE_STORAGE_KEY,
  PRICE_USD_ANNUAL,
  PRICE_USD_APPROX,
  PRICE_USD_MONTHLY,
} from '../config';
import { useI18n } from '../hooks/useLocale';
import { usePaymentStatus } from '../hooks/usePaymentStatus';
import { CopyField } from '../components/CopyField';
import { Qr } from '../components/Qr';

interface UpgradePageProps {
  readonly keypair: Keypair;
  readonly directory: Directory | null;
  /** Hash query params (`#/upgrade?code=…` desktop hand-off, `?session=…` Stripe return). */
  readonly params: URLSearchParams;
  readonly onNavigateConnect: () => void;
}

/**
 * Resolve the payment code this visit should credit. A `?code=` param (the
 * desktop app deep-links with ITS code so the payment unlocks the desktop
 * key, not the browser's) wins and is persisted across the whole Stripe
 * round-trip — BOTH returns keep it: `?session=` (success) and `?canceled=`
 * (the user backed out of checkout; the bridge's STRIPE_CANCEL_URL carries
 * it). Without the cancel case, backing out of checkout would silently swap
 * the QR/memo/checkout to the browser's own keypair and a retry would pay
 * the wrong key. Only a genuinely-plain visit clears the override.
 */
function resolveCode(params: URLSearchParams, browserPub: string): string {
  const fromParams = params.get('code');
  if (fromParams) {
    try {
      localStorage.setItem(PAY_CODE_OVERRIDE_STORAGE_KEY, fromParams);
    } catch {
      /* private mode */
    }
    return fromParams;
  }
  if (params.get('session') !== null || params.get('canceled') !== null) {
    try {
      const stored = localStorage.getItem(PAY_CODE_OVERRIDE_STORAGE_KEY);
      if (stored) {
        return stored;
      }
    } catch {
      /* private mode */
    }
  } else {
    try {
      localStorage.removeItem(PAY_CODE_OVERRIDE_STORAGE_KEY);
    } catch {
      /* private mode */
    }
  }
  try {
    return paymentCode(browserPub);
  } catch {
    return '';
  }
}

export function UpgradePage({ keypair, directory, params, onNavigateConnect }: UpgradePageProps) {
  const { t, rich } = useI18n();
  const session = params.get('session');
  const code = useMemo(() => resolveCode(params, keypair.publicKey), [params, keypair.publicKey]);
  const memo = code ? MEMO_PREFIX + code : '';

  const [plan, setPlan] = useState<PaymentPlan>('monthly');
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState(false);
  const phase = usePaymentStatus(code, session !== null);

  const selectPlan = (next: PaymentPlan): void => {
    setPlan(next);
    setCheckoutError(false);
  };

  const startCheckout = async (): Promise<void> => {
    setCheckoutBusy(true);
    setCheckoutError(false);
    try {
      // Stamp the start so the post-return poll ignores older payments
      // (a renewal's previous confirmed row must not read as this one).
      localStorage.setItem(PAY_CHECKOUT_STARTED_STORAGE_KEY, String(Math.floor(Date.now() / 1000)));
    } catch {
      /* private mode — poll falls back to the whole feed */
    }
    try {
      const { url } = await createStripeCheckout(
        fetch.bind(window),
        { code, plan },
        { baseUrl: BRIDGE_URL },
      );
      window.location.assign(url);
    } catch {
      setCheckoutError(true);
      setCheckoutBusy(false);
    }
  };

  if (!directory) {
    return (
      <main className="page">
        <div className="wrap">
          <div className="loading">{t('upgrade_loading')}</div>
        </div>
      </main>
    );
  }

  const { payment_address, price_flux } = directory;
  // QR: universal BIP21 `flux:` (any Flux wallet scans it; Zelcore too).
  // Click: Zelcore's `zel:` protocol, which is what Zelcore registers with the OS.
  const qrLink = walletDeepLink(payment_address, price_flux, memo, 'flux');
  const payLink = walletDeepLink(payment_address, price_flux, memo, 'zel');

  // Returning from Stripe Checkout: replace both pay cards with progress.
  if (session) {
    return (
      <main className="page">
        <div className="wrap narrow">
          <div className="page-head center">
            <span className="eyebrow">{t('upgrade_eyebrow_card')}</span>
            <h1>{t('upgrade_activating_title')}</h1>
          </div>
          <section className="card pay-card">
            <div className={`activation-state activation-${phase}`}>
              <p className="lede">
                {phase === 'confirmed'
                  ? t('upgrade_state_confirmed')
                  : phase === 'failed'
                    ? t('upgrade_state_failed')
                    : phase === 'broadcast'
                      ? t('upgrade_state_broadcast')
                      : t('upgrade_state_pending')}
              </p>
            </div>
            {phase !== 'confirmed' && phase !== 'failed' && (
              <p className="pay-note">{t('upgrade_activating_hint')}</p>
            )}
            {phase === 'confirmed' && (
              <div className="btn-row">
                <button className="btn amber block" onClick={onNavigateConnect}>
                  {t('upgrade_activated_cta')}
                </button>
              </div>
            )}
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="wrap narrow">
        <div className="page-head center">
          <span className="eyebrow">{t('upgrade_eyebrow')}</span>
          <h1>{t('upgrade_title')}</h1>
          <p className="lede">{t('upgrade_lede')}</p>
        </div>

        <section className="card pay-card">
          <div className="amount">
            <div className="big mono">{price_flux} FLUX</div>
            <div className="usd">{t('upgrade_usd_line', { usd: PRICE_USD_APPROX })}</div>
          </div>

          <div className="pay-qr">
            <Qr value={qrLink} size={176} />
            <span className="qr-cap mono">{t('upgrade_qr_caption')}</span>
          </div>

          <CopyField label={t('upgrade_field_address')} value={payment_address} />
          <CopyField label={t('upgrade_field_message')} value={memo} />

          <div className="btn-row">
            <a className="btn amber block" href={payLink}>
              {t('upgrade_open_wallet')}
            </a>
          </div>

          <p className="pay-note">
            {rich(
              'upgrade_prepay_note',
              { strong: (label) => <strong>{label}</strong> },
              { amount: price_flux * 3 },
            )}
          </p>

          <p className="pay-note">{t('upgrade_privacy_note')}</p>
        </section>

        <section className="card pay-card">
          <div className="page-head center">
            <span className="eyebrow">{t('upgrade_eyebrow_card')}</span>
            <p className="lede">{t('upgrade_card_lede')}</p>
          </div>

          <div className="btn-row plan-row" role="radiogroup" aria-label={t('upgrade_plan_aria')}>
            <button
              className={`btn block ${plan === 'monthly' ? 'amber' : ''}`}
              role="radio"
              aria-checked={plan === 'monthly'}
              onClick={() => selectPlan('monthly')}
            >
              {t('upgrade_plan_monthly', { usd: PRICE_USD_MONTHLY })}
            </button>
            <button
              className={`btn block ${plan === 'annual' ? 'amber' : ''}`}
              role="radio"
              aria-checked={plan === 'annual'}
              onClick={() => selectPlan('annual')}
            >
              {t('upgrade_plan_annual', { usd: PRICE_USD_ANNUAL })}
            </button>
          </div>

          <div className="btn-row">
            <button
              className="btn amber block"
              disabled={checkoutBusy || !code}
              onClick={() => void startCheckout()}
            >
              {checkoutBusy ? t('upgrade_card_cta_busy') : t('upgrade_card_cta')}
            </button>
          </div>

          {checkoutError && <p className="pay-note error">{t('upgrade_card_error')}</p>}
          <p className="pay-note">{t('upgrade_card_note')}</p>
        </section>

        <p className="back-link">
          <a
            href="#/connect"
            onClick={(e) => {
              e.preventDefault();
              onNavigateConnect();
            }}
          >
            {t('upgrade_back')}
          </a>
        </p>
      </div>
    </main>
  );
}
