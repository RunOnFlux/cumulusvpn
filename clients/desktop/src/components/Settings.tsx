import { useState } from 'react';
import type { JSX } from 'react';
import { normalizeSplitRule } from '@cumulusvpn/core';
import type { SplitMode, SplitPolicy, Tier } from '@cumulusvpn/core';
import { CVPN_DIRECTORY_PUBKEY } from '../lib/directory.js';
import { loadSplitPolicy, saveSplitPolicy } from '../lib/storage.js';

/** App version — matches the release tag. */
const APP_VERSION = '0.1.0';

interface Props {
  readonly autoConnect: boolean;
  readonly killSwitch: boolean;
  readonly stealth: boolean;
  readonly tier: Tier;
  readonly onAutoConnect: (v: boolean) => void;
  readonly onKillSwitch: (v: boolean) => void;
  readonly onStealth: (v: boolean) => void;
  readonly onClose: () => void;
}

/** Full-window settings sheet: connection preferences + about. */
export function Settings({
  autoConnect,
  killSwitch,
  stealth,
  tier,
  onAutoConnect,
  onKillSwitch,
  onStealth,
  onClose,
}: Props): JSX.Element {
  return (
    <div className="sheet">
      <h2>Settings</h2>

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

      <div className="setsec">Split tunneling · Premium</div>
      <SplitTunneling tier={tier} killSwitch={killSwitch} />

      <div className="setsec">About</div>
      <div className="setinfo">
        <span>Version</span>
        <span className="lat">CumulusVPN {APP_VERSION}</span>
      </div>
      <div className="setinfo">
        <span>Directory trust key</span>
        <span className="lat">{CVPN_DIRECTORY_PUBKEY.slice(0, 16)}…</span>
      </div>
      <a className="setinfo setlink" href="https://cumulusvpn.com" target="_blank" rel="noreferrer">
        <span>cumulusvpn.com</span>
        <span className="chev">›</span>
      </a>

      <button className="close" onClick={onClose}>
        Close
      </button>
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

function SettingToggle({
  label,
  sub,
  value,
  onChange,
}: {
  readonly label: string;
  readonly sub: string;
  readonly value: boolean;
  readonly onChange: (v: boolean) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className="setrow"
      role="switch"
      aria-checked={value}
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
