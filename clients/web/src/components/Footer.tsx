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
          <span className="mono">{t('footer_credit')}</span>
          <PoweredByFlux height={16} />
        </span>
      </div>
    </footer>
  );
}
