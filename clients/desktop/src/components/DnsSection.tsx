import { useState } from 'react';
import type { JSX } from 'react';
import { DEFAULT_DNS, DNS_OPTIONS } from '@cumulusvpn/core';
import type { DnsChoice } from '@cumulusvpn/core';
import { loadDnsChoice, saveDnsChoice } from '../lib/storage.js';

/**
 * Settings → DNS: which provider answers this computer's lookups. The choice
 * only changes the tunnel's `DNS =` addresses; the lookups still travel inside
 * the tunnel, and the gateway forwards them encrypted to that provider, so the
 * provider sees the gateway's address, never the user's.
 *
 * Read at connect time like split tunneling (the session layer loads it), so a
 * change applies on the next connect rather than dropping a live tunnel.
 * Native radio inputs: arrow keys, focus and screen-reader semantics for free.
 */
export function DnsSection(): JSX.Element {
  const [choice, setChoice] = useState<DnsChoice>(() => loadDnsChoice());
  const [changed, setChanged] = useState(false);

  const pick = (next: DnsChoice): void => {
    setChoice(next);
    saveDnsChoice(next);
    setChanged(true);
  };

  return (
    <div className="setrow st-wrap dns-wrap">
      <div className="dns-opts" role="radiogroup" aria-label="DNS provider">
        {DNS_OPTIONS.map((o) => (
          <label key={o.id} className={`dns-opt${choice === o.id ? ' on' : ''}`}>
            <input
              type="radio"
              name="cvpn-dns"
              value={o.id}
              checked={choice === o.id}
              onChange={() => pick(o.id)}
            />
            <span className="setmeta">
              <span className="setlabel">
                {o.provider}
                {o.id === DEFAULT_DNS && <span className="dns-default">Default</span>}
              </span>
              <span className="setsub">{o.blurb}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="st-note">
        Your DNS lookups go through the VPN to the provider you choose. It sees the VPN server’s
        address, never yours.
      </div>
      {changed && <div className="st-note">Changes apply the next time you connect.</div>}
    </div>
  );
}
