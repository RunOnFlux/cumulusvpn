import { useMemo, useState } from 'react';
import type { JSX } from 'react';
import { normalizeSplitRule } from '@cumulusvpn/core';
import type { SplitMode, SplitPolicy, Tier } from '@cumulusvpn/core';
import { CVPN_DIRECTORY_PUBKEY } from '../lib/directory.js';
import { codeOf, copyText } from '../lib/identity.js';
import { loadOrCreateKeypair, loadSplitPolicy, saveSplitPolicy } from '../lib/storage.js';
import { useEscape } from '../hooks/useEscape.js';
import { ensureNotificationPermission } from '../hooks/useNotifications.js';
import { openExternal } from '../lib/opener.js';
import { formatExpiry } from '../lib/payment.js';
import poweredByFlux from '../assets/powered_by_flux.png';
import { DnsSection } from './DnsSection.js';
import { IdentitySection } from './IdentitySection.js';

/** App version — matches the release tag. */
const APP_VERSION = '1.4.4';

const SITE_URL = 'https://cumulusvpn.com';
const PRIVACY_URL = 'https://cumulusvpn.com/privacy';
const TERMS_URL = 'https://cumulusvpn.com/terms';
const SUPPORT_URL = 'https://cumulusvpn.com/support';
const FLUX_URL = 'https://runonflux.com';

interface Props {
  readonly autoConnect: boolean;
  readonly killSwitch: boolean;
  readonly stealth: boolean;
  readonly tier: Tier;
  /** Premium expiry (`paid_until`), when known. */
  readonly paidUntil: string | null;
  readonly nodeDiversity: boolean;
  readonly notifications: boolean;
  /** A tunnel is up or coming up: routing choices wait for the next connect. */
  readonly sessionActive: boolean;
  readonly onNodeDiversity: (v: boolean) => void;
  readonly onNotifications: (v: boolean) => void;
  readonly onAutoConnect: (v: boolean) => void;
  readonly onKillSwitch: (v: boolean) => void;
  readonly onStealth: (v: boolean) => void;
  /** Open the Upgrade sheet (plans, add time). */
  readonly onOpenUpgrade: () => void;
  readonly onClose: () => void;
  /** Open with the recovery key showing (from the "save your key" nudge). */
  readonly revealRecoveryKey?: boolean;
}

/** Full-window settings sheet: connection preferences + about. */
export function Settings({
  autoConnect,
  killSwitch,
  stealth,
  tier,
  paidUntil,
  nodeDiversity,
  notifications,
  sessionActive,
  onNodeDiversity,
  onNotifications,
  onAutoConnect,
  onKillSwitch,
  onStealth,
  onOpenUpgrade,
  onClose,
  revealRecoveryKey = false,
}: Props): JSX.Element {
  useEscape(onClose);
  return (
    <div className="sheet">
      <div className="sheet-inner">
        <h2>Settings</h2>

        {/* The About block and the split-tunnel editor together overflow any
            reasonable window height — this region is what scrolls. */}
        <div className="sheet-body scroll-y">
          <div className="setsec">Plan</div>
          <PlanRow tier={tier} paidUntil={paidUntil} onOpen={onOpenUpgrade} />

          <div className="setsec">Connection</div>
          <SettingToggle
            label="Auto-connect on launch"
            sub="Connect automatically when the app opens"
            value={autoConnect}
            onChange={onAutoConnect}
          />
          <SettingToggle
            label="Kill switch"
            sub="Block all traffic if the VPN drops"
            value={killSwitch}
            onChange={onKillSwitch}
          />
          <SettingToggle
            label="Stealth mode"
            sub="Disguise VPN traffic to bypass blocking"
            value={stealth}
            onChange={onStealth}
          />
          {/* Node diversity — force the two multi-hop legs onto different
              networks so they can't be the same rack (docs/11). Read when a
              route is built, so it is locked while a session exists rather
              than imply an effect it won't have yet. */}
          <SettingToggle
            label="Node diversity"
            sub={
              sessionActive
                ? 'Force multi-hop entry and exit onto different networks — disconnect to change'
                : 'Force multi-hop entry and exit onto different networks'
            }
            value={nodeDiversity}
            disabled={sessionActive}
            onChange={onNodeDiversity}
          />
          <SettingToggle
            label="Notifications"
            sub="Tell me when the VPN connects, drops or reconnects"
            value={notifications}
            onChange={(v) => {
              onNotifications(v);
              // Ask macOS / Windows now, while the user is looking — not at
              // the first drop, when the prompt would be a surprise.
              if (v) {
                void ensureNotificationPermission();
              }
            }}
          />

          <div className="setsec">DNS</div>
          <DnsSection />

          <div className="setsec">Identity · Recovery key</div>
          <IdentitySection revealKey={revealRecoveryKey} />

          <div className="setsec">Split tunneling · Premium</div>
          <SplitTunneling tier={tier} killSwitch={killSwitch} />

          <div className="setsec">About</div>
          <div className="setinfo">
            <span>Version</span>
            <span className="lat">CumulusVPN {APP_VERSION}</span>
          </div>
          <DeviceCodeRow />
          <div className="setinfo">
            <span>Directory trust key</span>
            <span className="lat">{CVPN_DIRECTORY_PUBKEY.slice(0, 16)}…</span>
          </div>
          <LinkRow label="cumulusvpn.com" url={SITE_URL} />

          <div className="setsec">Privacy &amp; support</div>
          <LinkRow label="Privacy Policy" url={PRIVACY_URL} />
          <LinkRow label="Terms of Service" url={TERMS_URL} />
          <LinkRow label="Support" url={SUPPORT_URL} />

          <p className="setfoot">
            Decentralized WireGuard VPN on Flux Cloud. No logs; your key stays on this device and in
            any recovery key you save.
          </p>
          <button
            type="button"
            className="poweredby"
            aria-label="Powered by Flux — opens runonflux.com"
            onClick={() => void openExternal(FLUX_URL)}
          >
            <img src={poweredByFlux} alt="Powered by Flux" width={130} height={18} />
          </button>
        </div>

        <button className="close" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

/**
 * Split-tunneling editor (docs/17 §8): global mode, LAN bypass, CIDR rules.
 * Domain rules are deferred (open question 1) and desktop app rules are Phase
 * 4, so IP rules are the whole surface here. Rules can be authored on any tier
 * (§7.6); activation is premium-only, and the session layer re-checks the gate
 * at connect time, so this UI's job is honesty, not enforcement.
 */
function SplitTunneling({
  tier,
  killSwitch,
}: {
  readonly tier: Tier;
  readonly killSwitch: boolean;
}): JSX.Element {
  const [policy, setPolicy] = useState<SplitPolicy>(() => loadSplitPolicy());
  const [draft, setDraft] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const premium = tier === 'premium';

  const update = (next: SplitPolicy): void => {
    setPolicy(next);
    saveSplitPolicy(next);
  };

  const onAdd = (): void => {
    const value = draft.trim();
    if (value === '') {
      return;
    }
    try {
      const rule = normalizeSplitRule({ kind: 'cidr', value });
      if (!policy.rules.some((r) => r.kind === 'cidr' && r.value === rule.value)) {
        update({ ...policy, rules: [...policy.rules, rule] });
      }
      setDraft('');
      setInputError(null);
    } catch (err) {
      setInputError(err instanceof Error ? err.message : 'Not a valid IP or CIDR range.');
    }
  };

  const cidrRules = policy.rules.filter((r) => r.kind === 'cidr');
  const MODES: readonly (readonly [SplitMode, string])[] = [
    ['off', 'Off'],
    ['exclude', 'Exclude listed'],
    ['include', 'Only these'],
  ];

  return (
    <div className="setrow st-wrap">
      <div className="st-modes" role="radiogroup" aria-label="Split tunneling mode">
        {MODES.map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={policy.mode === mode}
            className={`st-mode${policy.mode === mode ? ' on' : ''}`}
            disabled={!premium && mode !== 'off'}
            onClick={() => update({ ...policy, mode })}
          >
            {label}
          </button>
        ))}
      </div>

      {!premium && (
        <div className="st-note">
          Split tunneling is a premium feature — upgrade to route only the traffic you choose. Rules
          can be set up now and activate with premium.
        </div>
      )}
      {policy.mode !== 'off' && (
        <div className="st-warn">
          {policy.mode === 'exclude'
            ? 'Excluded traffic leaves this device unprotected and shows your real IP address.'
            : 'Only the listed destinations are protected — everything else shows your real IP address.'}
        </div>
      )}
      {policy.mode === 'include' && killSwitch && (
        <div className="st-warn">
          The kill switch blocks all non-VPN traffic, which is exactly what “Only these” mode sends
          directly — while both are on, the kill switch wins and these rules are not applied.
        </div>
      )}

      <label className="st-lan">
        <input
          type="checkbox"
          checked={policy.lanBypass}
          onChange={(e) => update({ ...policy, lanBypass: e.target.checked })}
          disabled={!premium}
        />
        <span>Allow local network access (printers, NAS, casting)</span>
      </label>

      {policy.mode !== 'off' && (
        <>
          <div className="st-add">
            <input
              className="st-input"
              type="text"
              placeholder="e.g. 192.168.0.0/16 or 203.0.113.7"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setInputError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onAdd();
                }
              }}
              aria-label="IP address or CIDR range"
            />
            <button type="button" className="st-addbtn" onClick={onAdd} disabled={!draft.trim()}>
              Add
            </button>
          </div>
          {inputError && <div className="st-error">{inputError}</div>}
          {cidrRules.length === 0 ? (
            <div className="st-note">No IP rules yet — add a range above.</div>
          ) : (
            <ul className="st-rules">
              {cidrRules.map((r) => (
                <li key={r.value} className="st-rule">
                  <span>{r.value}</span>
                  <button
                    type="button"
                    className="st-remove"
                    aria-label={`Remove rule ${r.value}`}
                    onClick={() =>
                      update({ ...policy, rules: policy.rules.filter((x) => x.value !== r.value) })
                    }
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {(policy.mode !== 'off' || policy.lanBypass) && (
        <div className="st-note">Rules apply the next time you connect.</div>
      )}
    </div>
  );
}

/**
 * This computer's Device code — the payment code Premium is bound to. Copied
 * from here to pay for this computer from another browser, or to give support.
 */
function DeviceCodeRow(): JSX.Element {
  const code = useMemo(() => codeOf(loadOrCreateKeypair()), []);
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="setinfo setcopy"
      title="Copy"
      disabled={!code}
      onClick={() =>
        void copyText(code).then((ok) => {
          if (ok) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          }
        })
      }
    >
      <span>Device code</span>
      <span className="lat">{copied ? 'Copied' : code}</span>
    </button>
  );
}

/** Current plan and expiry, as on mobile; opens the Upgrade sheet. */
function PlanRow({
  tier,
  paidUntil,
  onOpen,
}: {
  readonly tier: Tier;
  readonly paidUntil: string | null;
  readonly onOpen: () => void;
}): JSX.Element {
  const premium = tier === 'premium';
  const expiry = premium ? formatExpiry(paidUntil) : null;
  const status = premium
    ? expiry
      ? `Active until ${expiry.date} · ${expiry.daysLeft} ${expiry.daysLeft === 1 ? 'day' : 'days'} left`
      : 'Full speed on every server'
    : 'Limited to 100 KB/s — upgrade for full speed';
  return (
    <button
      type="button"
      className="setrow planrow"
      aria-label={premium ? 'Manage your Premium plan' : 'Upgrade to Premium'}
      onClick={onOpen}
    >
      <span className="setmeta">
        <span className={`tier-pill ${tier}`}>{tier}</span>
        <span className="setsub">{status}</span>
      </span>
      <span className="chev">›</span>
    </button>
  );
}

function LinkRow({ label, url }: { readonly label: string; readonly url: string }): JSX.Element {
  return (
    <button type="button" className="setinfo setlink" onClick={() => void openExternal(url)}>
      <span>{label}</span>
      <span className="chev">›</span>
    </button>
  );
}

function SettingToggle({
  label,
  sub,
  value,
  onChange,
  disabled = false,
}: {
  readonly label: string;
  readonly sub: string;
  readonly value: boolean;
  readonly onChange: (v: boolean) => void;
  readonly disabled?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      className="setrow"
      role="switch"
      aria-checked={value}
      disabled={disabled}
      onClick={() => onChange(!value)}
    >
      <span className="setmeta">
        <span className="setlabel">{label}</span>
        <span className="setsub">{sub}</span>
      </span>
      <span className={`ks-track ${value ? 'on' : ''}`}>
        <span className="ks-thumb" />
      </span>
    </button>
  );
}
