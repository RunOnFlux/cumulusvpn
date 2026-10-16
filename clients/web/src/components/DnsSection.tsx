import { useId } from 'react';
import { DEFAULT_DNS, DNS_OPTIONS, dnsOption } from '@cumulusvpn/core';
import type { DnsChoice } from '@cumulusvpn/core';
import type { MessageKey } from '../i18n';
import { useI18n } from '../hooks/useLocale';

/** What each option blocks, localized by id. Provider names are brands. */
const BLURB_KEYS: Record<DnsChoice, MessageKey> = {
  cloudflare: 'dns_blurb_cloudflare',
  mullvad: 'dns_blurb_mullvad',
  google: 'dns_blurb_google',
  quad9: 'dns_blurb_quad9',
  dns4eu: 'dns_blurb_dns4eu',
  adguard: 'dns_blurb_adguard',
  family: 'dns_blurb_family',
};

interface DnsSectionProps {
  readonly value: DnsChoice;
  readonly onChange: (choice: DnsChoice) => void;
}

/**
 * DNS provider picker (collapsed by default, every tier). The choice is only
 * the `DNS =` address the generated configs carry: lookups ride the tunnel to
 * that address and the gateway forwards them, encrypted, to the same provider
 * (docs/03-gateway.md "DNS"). The current pick shows in the summary, so a
 * non-default choice is visible without opening the card.
 */
export function DnsSection({ value, onChange }: DnsSectionProps) {
  const { t } = useI18n();
  const titleId = useId();

  return (
    <section className="card mh dns">
      <details>
        <summary>
          <span className="mh-sum">
            <span className="mh-title" id={titleId}>
              {t('dns_summary_title')}
            </span>
            <span className="dns-pill">{dnsOption(value).provider}</span>
          </span>
          <span className="mh-caret" aria-hidden="true">
            ▾
          </span>
        </summary>

        <div className="mh-body">
          <div className="dns-opts" role="radiogroup" aria-labelledby={titleId}>
            {DNS_OPTIONS.map((o) => (
              <label key={o.id} className={`dns-opt${o.id === value ? ' on' : ''}`}>
                <input
                  type="radio"
                  name={titleId}
                  value={o.id}
                  checked={o.id === value}
                  onChange={() => onChange(o.id)}
                />
                <span className="dns-txt">
                  <span className="dns-name">
                    {o.provider}
                    {o.id === DEFAULT_DNS ? (
                      <span className="dns-default">{t('dns_default')}</span>
                    ) : null}
                  </span>
                  <span className="dns-blurb">{t(BLURB_KEYS[o.id])}</span>
                </span>
              </label>
            ))}
          </div>

          <p className="muted-text">{t('dns_note')}</p>
          <p className="muted-text">{t('dns_apply_note')}</p>
        </div>
      </details>
    </section>
  );
}
