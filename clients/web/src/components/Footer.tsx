import { PRIVACY_URL, SOURCE_URL, TERMS_URL } from '../config';
import { useI18n } from '../hooks/useLocale';
import { PoweredByFlux } from './PoweredByFlux';

/** Page footer mirroring the mockup's quiet, monospaced credit line. */
export function Footer() {
  const { t } = useI18n();
  return (
    <footer>
      <div className="wrap">
        <span>{t('footer_tagline')}</span>
        <span className="footer-credit">
          <a href={TERMS_URL}>{t('footer_terms')}</a>
          <a href={PRIVACY_URL}>{t('footer_privacy')}</a>
          <a className="mono" href={SOURCE_URL} target="_blank" rel="noreferrer">
            {t('footer_credit')} · GitHub
          </a>
          <PoweredByFlux height={16} />
        </span>
      </div>
    </footer>
  );
}
