import { useEffect, useMemo, useState } from 'react';
import {
  ApiError,
  createStripeCheckout,
  isValidPaymentCode,
  openBillingPortal,
  paymentCode,
  redeemVoucher,
  walletDeepLink,
  MEMO_PREFIX,
} from '@cumulusvpn/core';
import type { Directory, Keypair, PaymentPlan } from '@cumulusvpn/core';
import {
  BRIDGE_URL,
  PAY_CHECKOUT_STARTED_STORAGE_KEY,
  PAY_CODE_OVERRIDE_STORAGE_KEY,
  PAY_PORTAL_SESSIONS_STORAGE_KEY,
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

/**
 * Checkout sessions we have seen come back successfully, keyed by the payment
 * code they paid for. This is the whole "account" behind self-service billing:
 * with no login, the Checkout Session id is the only thing that can authorize
 * a billing portal (see openBillingPortal), and only this browser ever had it.
 */
function readPortalSessions(): Record<string, string> {
  try {
    const raw = localStorage.getItem(PAY_PORTAL_SESSIONS_STORAGE_KEY);
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, string>;
  } catch {
    // Private mode, or a hand-mangled entry — treat as "no subscription here".
    return {};
  }
}

/**
 * Whether a `?session=` value is plausibly a Stripe Checkout Session id.
 *
 * Guards two things. An empty `?session=` reads as non-null and would render
 * a Manage button whose request the bridge rejects outright. And because the
 * stored id is unrecoverable — there is no account to restore it from — a
 * crafted link would otherwise let anyone permanently overwrite a
 * subscriber's real id with junk and kill their management path for good.
 */
function isCheckoutSessionId(value: string): boolean {
  return value.startsWith('cs_') && value.length >= 10 && value.length <= 200;
}

function rememberPortalSession(code: string, sessionId: string): void {
  try {
    localStorage.setItem(
      PAY_PORTAL_SESSIONS_STORAGE_KEY,
      JSON.stringify({ ...readPortalSessions(), [code]: sessionId }),
    );
  } catch {
    /* private mode — management falls back to the Stripe receipt email */
  }
}

export function UpgradePage({ keypair, directory, params, onNavigateConnect }: UpgradePageProps) {
  const { t, rich } = useI18n();
  const session = params.get('session');
  /**
   * A Device code pasted by hand, for paying from a desktop browser on behalf
   * of a phone. Store-build apps cannot link here (external-purchase steering),
   * so the code is transcribed from Settings → About; this is the only way a
   * mobile user reaches web pricing.
   *
   * It rides the SAME localStorage override the desktop `?code=` hand-off uses,
   * so it survives the Stripe round-trip. A genuinely plain visit clears it —
   * deliberately, so a stale foreign code can never quietly collect a later
   * payment. Failing back to this browser's own key is the safe direction.
   */
  const [manualCode, setManualCode] = useState<string | null>(null);
  const code = useMemo(
    () => manualCode ?? resolveCode(params, keypair.publicKey),
    [manualCode, params, keypair.publicKey],
  );
  const memo = code ? MEMO_PREFIX + code : '';
  const ownCode = useMemo(() => {
    try {
      return paymentCode(keypair.publicKey);
    } catch {
      return '';
    }
  }, [keypair.publicKey]);
  const [codeInput, setCodeInput] = useState('');
  const [codeError, setCodeError] = useState(false);

  const applyCode = (): void => {
    const trimmed = codeInput.trim();
    if (!isValidPaymentCode(trimmed)) {
      setCodeError(true);
      return;
    }
    setCodeError(false);
    try {
      localStorage.setItem(PAY_CODE_OVERRIDE_STORAGE_KEY, trimmed);
    } catch {
      /* private mode — the override still holds for this page view */
    }
    setManualCode(trimmed);
    setCodeInput('');
  };

  const clearCode = (): void => {
    setCodeError(false);
    setCodeInput('');
    try {
      localStorage.removeItem(PAY_CODE_OVERRIDE_STORAGE_KEY);
    } catch {
      /* private mode */
    }
    setManualCode(null);
  };

  const [plan, setPlan] = useState<PaymentPlan>('monthly');
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState(false);
  // Voucher box: prefilled from a marketing deep-link (#/upgrade?voucher=CODE).
  const [voucherInput, setVoucherInput] = useState(() => params.get('voucher') ?? '');
  const [voucherBusy, setVoucherBusy] = useState(false);
  const [voucherError, setVoucherError] = useState<string | null>(null);
  /** A grant code was consumed — show the activation panel. */
  const [redeemed, setRedeemed] = useState(false);
  /** A discount code was validated — carried into checkout. */
  const [discount, setDiscount] = useState<{ code: string; percentOff: number } | null>(null);
  const phase = usePaymentStatus(code, session !== null || redeemed);
  const [portalBusy, setPortalBusy] = useState(false);
  const [portalError, setPortalError] = useState(false);
  /** Checkout session for THIS code, if this browser bought the subscription. */
  const portalSession = useMemo(() => {
    if (session !== null && isCheckoutSessionId(session)) {
      return session;
    }
    const stored = code === '' ? undefined : readPortalSessions()[code];
    return stored !== undefined && isCheckoutSessionId(stored) ? stored : null;
  }, [session, code]);

  // A `?session=` return is the one moment the id exists; persist it against
  // the code that was paid for (which may be the desktop hand-off code, not
  // this browser's) so a later visit can still offer management.
  useEffect(() => {
    if (session !== null && code !== '' && isCheckoutSessionId(session)) {
      rememberPortalSession(code, session);
    }
  }, [session, code]);

  const openPortal = async (): Promise<void> => {
    if (portalSession === null || portalBusy) {
      return;
    }
    setPortalBusy(true);
    setPortalError(false);
    try {
      const { url } = await openBillingPortal(
        fetch.bind(window),
        { code, sessionId: portalSession },
        { baseUrl: BRIDGE_URL },
      );
      window.location.assign(url);
    } catch {
      // Includes `no_subscription` (session expired from Stripe's side, or the
      // subscription is long gone) — the receipt-email fallback covers both.
      setPortalError(true);
      setPortalBusy(false);
    }
  };

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
        { code, plan, ...(discount ? { voucher: discount.code } : {}) },
        { baseUrl: BRIDGE_URL },
      );
      window.location.assign(url);
    } catch {
      setCheckoutError(true);
      setCheckoutBusy(false);
    }
  };

  const redeem = async (): Promise<void> => {
    const trimmed = voucherInput.trim();
    if (trimmed === '' || voucherBusy) {
      return;
    }
    setVoucherBusy(true);
    setVoucherError(null);
    try {
      localStorage.setItem(PAY_CHECKOUT_STARTED_STORAGE_KEY, String(Math.floor(Date.now() / 1000)));
    } catch {
      /* private mode — poll falls back to the whole feed */
    }
    try {
      const outcome = await redeemVoucher(
        fetch.bind(window),
        { code, voucher: trimmed },
        { baseUrl: BRIDGE_URL },
      );
      if (outcome.type === 'grant_days') {
        setRedeemed(true);
      } else {
        setDiscount({ code: trimmed, percentOff: outcome.percent_off });
      }
    } catch (e) {
      const slug = e instanceof ApiError ? e.slug : 'network';
      const key =
        slug === 'expired'
          ? 'redeem_err_expired'
          : slug === 'exhausted'
            ? 'redeem_err_exhausted'
            : slug === 'already_redeemed'
              ? 'redeem_err_already'
              : slug === 'temporarily_unavailable' || slug === 'rate_limited'
                ? 'redeem_err_later'
                : 'redeem_err_invalid';
      setVoucherError(t(key));
    } finally {
      setVoucherBusy(false);
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

  // Returning from Stripe Checkout, or a grant code just redeemed:
  // replace the pay cards with settlement progress.
  if (session || redeemed) {
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

        {/*
          Lets a phone user pay here. Store builds cannot link to the web
          (Apple 3.1.1 external-purchase steering), so the Device code is
          transcribed by hand from Settings → About.

          The active code is echoed back deliberately: isValidPaymentCode
          rejects malformed input but CANNOT catch a typo that still decodes
          to 20 bytes — that lands on a different, valid key and would pay the
          wrong device silently. Showing it is the only check left.
        */}
        <section className="card pay-card">
          <div className="page-head center">
            <span className="eyebrow">{t('otherdev_eyebrow')}</span>
            <p className="lede">{t('otherdev_lede')}</p>
          </div>
          {manualCode === null ? (
            <>
              <div className="btn-row">
                <input
                  className="mono"
                  style={{ flex: 1, padding: '12px', fontSize: '15px' }}
                  value={codeInput}
                  placeholder={t('otherdev_placeholder')}
                  onChange={(e) => {
                    setCodeInput(e.target.value);
                    setCodeError(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      applyCode();
                    }
                  }}
                  aria-label={t('otherdev_placeholder')}
                />
                <button
                  className="btn amber"
                  disabled={codeInput.trim() === ''}
                  onClick={applyCode}
                >
                  {t('otherdev_apply')}
                </button>
              </div>
              {codeError && <p className="pay-note error">{t('otherdev_err')}</p>}
            </>
          ) : (
            <>
              <p className="pay-note">{t('otherdev_active')}</p>
              <CopyField label={t('otherdev_placeholder')} value={manualCode} />
              <div className="btn-row">
                <button className="btn block" onClick={clearCode}>
                  {t('otherdev_clear', { code: ownCode.slice(0, 8) })}
                </button>
              </div>
            </>
          )}
        </section>

        {/*
          Always rendered, because `upgrade_card_note` above promises this
          section by name. Without a checkout session on file there is nothing
          we can open — that is the common case for a first visit, and for a
          subscriber on a fresh browser — so it explains where to go instead.
        */}
        <section className="card pay-card">
          <div className="page-head center">
            <span className="eyebrow">{t('manage_eyebrow')}</span>
            <p className="lede">{portalSession === null ? t('manage_none') : t('manage_lede')}</p>
          </div>
          {portalSession !== null && (
            <>
              <div className="btn-row">
                <button
                  className="btn block"
                  disabled={portalBusy}
                  onClick={() => void openPortal()}
                >
                  {portalBusy ? t('manage_cta_busy') : t('manage_cta')}
                </button>
              </div>
              {portalError && <p className="pay-note error">{t('manage_err')}</p>}
            </>
          )}
        </section>

        <section className="card pay-card">
          <div className="page-head center">
            <span className="eyebrow">{t('redeem_eyebrow')}</span>
            <p className="lede">{t('redeem_lede')}</p>
          </div>
          <div className="btn-row">
            <input
              className="mono"
              style={{ flex: 1, padding: '12px', fontSize: '15px' }}
              value={voucherInput}
              placeholder={t('redeem_placeholder')}
              onChange={(e) => {
                setVoucherInput(e.target.value);
                setVoucherError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  void redeem();
                }
              }}
              aria-label={t('redeem_placeholder')}
            />
            <button
              className="btn amber"
              disabled={voucherBusy || voucherInput.trim() === ''}
              onClick={() => void redeem()}
            >
              {voucherBusy ? t('redeem_cta_busy') : t('redeem_cta')}
            </button>
          </div>
          {voucherError && <p className="pay-note error">{voucherError}</p>}
          {discount && (
            <p className="pay-note">
              {t('redeem_discount_applied', { percent: discount.percentOff })}
            </p>
          )}
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
