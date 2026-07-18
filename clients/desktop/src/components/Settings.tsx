import type { JSX } from 'react';
import { CVPN_DIRECTORY_PUBKEY } from '../lib/directory.js';

/** App version — matches the release tag. */
const APP_VERSION = '0.1.0';

interface Props {
  readonly autoConnect: boolean;
  readonly killSwitch: boolean;
  readonly onAutoConnect: (v: boolean) => void;
  readonly onKillSwitch: (v: boolean) => void;
  readonly onClose: () => void;
}

/** Full-window settings sheet: connection preferences + about. */
export function Settings({
  autoConnect,
  killSwitch,
  onAutoConnect,
  onKillSwitch,
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
