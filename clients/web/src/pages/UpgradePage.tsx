import { useMemo } from 'react';
import { paymentMemo, walletDeepLink } from '@cumulusvpn/core';
import type { Directory, Keypair } from '@cumulusvpn/core';
import { PRICE_USD_APPROX } from '../config';
import { useI18n } from '../hooks/useLocale';
import { CopyField } from '../components/CopyField';
import { Qr } from '../components/Qr';

interface UpgradePageProps {
  readonly keypair: Keypair;
  readonly directory: Directory | null;
  readonly onNavigateConnect: () => void;
}

export function UpgradePage({ keypair, directory, onNavigateConnect }: UpgradePageProps) {
  const { t, rich } = useI18n();
  const memo = useMemo(() => {
    try {
      return paymentMemo(keypair.publicKey);
    } catch {
      return '';
    }
  }, [keypair.publicKey]);

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
