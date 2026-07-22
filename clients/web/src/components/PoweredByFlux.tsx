import { useI18n } from '../hooks/useLocale';

/**
 * "Powered by Flux" — the official Flux lockup (logo + wordmark), linking to
 * runonflux.com. Two art variants are shipped and swapped by theme in CSS
 * (`.pbf` rules in styles.css): dark art on light backgrounds, light art on
 * dark. Matches the mobile app's attribution for consistent branding.
 */
export function PoweredByFlux({ height = 18 }: { height?: number }) {
  const { t } = useI18n();
  return (
    <a
      className="pbf"
      href="https://runonflux.com"
      target="_blank"
      rel="noreferrer"
      aria-label={t('common_powered_by_flux_link')}
    >
      <img
        className="pbf-on-light"
        src="/powered_by_dark.svg"
        alt={t('common_powered_by_flux_alt')}
        height={height}
      />
      <img
        className="pbf-on-dark"
        src="/powered_by_light.svg"
        alt=""
        height={height}
        aria-hidden="true"
      />
    </a>
  );
}
