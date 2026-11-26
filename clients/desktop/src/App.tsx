import { useState } from 'react';
import type { JSX } from 'react';
import { useConnection } from './hooks/useConnection.js';
import { useTray } from './hooks/useTray.js';
import { useNotifications } from './hooks/useNotifications.js';
import { ConnectOrb } from './components/ConnectOrb.js';
import { CountryPicker } from './components/CountryPicker.js';
import { MultihopPanel } from './components/MultihopPanel.js';
import { TierBadge } from './components/TierBadge.js';
import { Upgrade } from './components/Upgrade.js';
import { StatBar } from './components/StatBar.js';
import { useUpdater } from './hooks/useUpdater.js';
import type { Updater } from './hooks/useUpdater.js';
import { SessionTimer } from './components/SessionTimer.js';
import { Settings } from './components/Settings.js';
import { helperReady, openHelperSettings } from './lib/tauri.js';
import { desktopOs, setupBanner } from './lib/setup.js';
import { RecoveryNudge } from './components/RecoveryNudge.js';
import { cardLatency } from './lib/liveStats.js';

/** Which hop the country picker is currently editing, or closed. */
type PickerTarget = 'entry' | 'exit' | null;

/** Settings gear: eight teeth around a ring, drawn in the text colour. */
function GearIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <g fill="currentColor">
        {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
          <rect
            key={deg}
            x="10.4"
            y="1.6"
            width="3.2"
            height="5"
            rx="1"
            transform={`rotate(${deg} 12 12)`}
          />
        ))}
      </g>
      <circle cx="12" cy="12" r="6.6" fill="none" stroke="currentColor" strokeWidth="2.6" />
      <circle cx="12" cy="12" r="2.4" fill="currentColor" />
    </svg>
  );
}

/** The update banner's sentence for each phase (hooks/useUpdater). */
function updateText(u: Updater, connected: boolean): string {
  const v = u.version ? `CumulusVPN ${u.version}` : 'The update';
  const drop = connected ? ' Restarting disconnects the VPN for a moment.' : '';
  switch (u.phase) {
    case 'downloading':
      return u.progress != null
        ? `Downloading ${v}… ${Math.round(u.progress * 100)}%`
        : `Downloading ${v}…`;
    case 'ready':
      return `${v} is ready to install.${drop}`;
    case 'available':
      return `${v} is available.${drop}`;
    case 'external':
      return `${v} is available. Update it with your system’s software updater, or run: sudo apt upgrade (Fedora: sudo dnf upgrade).`;
    case 'installing':
      return `Installing ${v}… the app restarts by itself.`;
    case 'failed':
      return 'The update couldn’t be installed. Try again later, or download it from cumulusvpn.com.';
    default:
      return '';
  }
}

function pingClass(load: number): string {
  if (load < 0.4) {
    return 'ping';
  }
  if (load < 0.75) {
    return 'ping mid';
  }
  return 'ping far';
}

export function App(): JSX.Element {
  const conn = useConnection();
  const update = useUpdater(conn.notifications);
  useTray(conn);
  useNotifications(conn);
  const [picker, setPicker] = useState<PickerTarget>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  // Settings opened from the "save your recovery key" nudge shows the key.
  const [revealKey, setRevealKey] = useState(false);

  const connected = conn.phase === 'connected';
  const busy = conn.phase === 'connecting';
  const locked = connected || busy;
  const ready = helperReady(conn.helperState);
  const banner = setupBanner(conn.helperState, desktopOs(navigator.userAgent));
  const { selected } = conn;

  return (
    <div className="shell">
      <div className="titlebar">
        <div className="brand">
          <span className="dot" />
          CumulusVPN
        </div>
        <button className="gear" onClick={() => setShowSettings(true)} aria-label="Settings">
          <GearIcon />
        </button>
      </div>

      {/* The app holds no privileges: the tunnel belongs to the helper daemon
          (LaunchDaemon / systemd service / Windows service). Until it is there
          and serves this app Connect cannot work, so say that up front with
          the fix attached, rather than letting the user press Connect and meet
          a transport error. An elevated app running the tunnel itself gets a
          non-blocking note instead (lib/setup.ts). */}
      {update.phase !== 'none' && (
        <div className="setup update" role="status">
          <div className="setup-text">
            {updateText(update, connected)}
            {update.phase === 'downloading' && (
              <div className="update-bar" aria-hidden="true">
                <div
                  className={`update-fill ${update.progress == null ? 'indeterminate' : ''}`}
                  style={{ width: `${Math.round((update.progress ?? 0.3) * 100)}%` }}
                />
              </div>
            )}
          </div>
          {(update.phase === 'available' || update.phase === 'ready') && (
            <button className="setup-btn" onClick={update.install}>
              {update.phase === 'ready' ? 'Restart to update' : 'Update now'}
            </button>
          )}
          {update.phase !== 'installing' && (
            <button className="setup-x" aria-label="Hide" onClick={update.dismiss}>
              ×
            </button>
          )}
        </div>
      )}

      {banner && (
        <div className={banner.blocking ? 'setup' : 'setup info'} role="status">
          <div className="setup-text">{banner.text}</div>
          {banner.openSettings && (
            <button className="setup-btn" onClick={() => void openHelperSettings()}>
              Open Settings
            </button>
          )}
        </div>
      )}

      <div className="shell-body scroll-y">
        <ConnectOrb
          phase={conn.phase}
          blocked={conn.blocked}
          disconnecting={conn.disconnecting}
          onToggle={connected || busy || conn.blocked ? conn.disconnect : conn.connect}
        />
        {/* Never leave "why is my internet gone?" unanswered (mobile's HOLD). */}
        {conn.blocked && (
          <div className="blocked-note" role="alert">
            Connection lost — the kill switch is blocking all traffic so nothing leaks while
            CumulusVPN reconnects. Disconnect to use the internet without the VPN.
          </div>
        )}

        {connected && conn.connectedSince && <SessionTimer since={conn.connectedSince} />}
        {/* docs/17 §8: with split rules active, the user must never be unsure
            whether they are fully protected — say so persistently. */}
        {connected && conn.splitActive && <div className="split-on">Split tunneling on</div>}
        {/* The tunnel is up but the system resolver is not the tunnel's: never
            let that read as fully protected. */}
        {conn.dnsWarning && (
          <div className="dns-warn" role="alert">
            {conn.dnsWarning}
          </div>
        )}

        <button
          className="loc-btn"
          onClick={() => setPicker('entry')}
          disabled={conn.countries.length === 0}
        >
          {conn.multihop && <span className="hop-tag entry">ENTRY</span>}
          <span className="flag">{selected?.flag ?? '🌐'}</span>
          <span className="meta">
            <span className="n">
              {selected
                ? conn.automatic && !connected
                  ? `Automatic · ${selected.name}`
                  : selected.name
                : conn.phase === 'loading'
                  ? 'Finding servers…'
                  : 'No locations'}
            </span>
            <span className="s">
              {selected
                ? [
                    selected.city || selected.code,
                    cardLatency(connected, conn.pingMs, selected.latencyMs),
                    selected.gatewayIp,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : conn.phase === 'loading' || conn.refreshing
                  ? 'discovering fleet…'
                  : 'Retrying automatically…'}
            </span>
          </span>
          {selected && (
            <span
              className={`${pingClass(selected.load)} ${conn.refreshing && !connected ? 'refreshing' : ''}`}
              title={conn.refreshing && !connected ? 'Refreshing servers…' : undefined}
            />
          )}
          <span className="chev">›</span>
        </button>

        <MultihopPanel
          multihop={conn.multihop}
          onToggle={conn.setMultihop}
          routeStyle={conn.routeStyle}
          onRouteStyle={conn.setRouteStyle}
          exit={conn.exit}
          sessionExit={conn.sessionExit}
          onOpenExit={() => setPicker('exit')}
          locked={locked}
        />

        <button
          type="button"
          className="ks-row"
          role="switch"
          aria-checked={conn.killSwitch}
          onClick={() => !busy && conn.setKillSwitch(!conn.killSwitch)}
          disabled={busy}
        >
          <span className="ks-icon">🛡️</span>
          <span className="ks-meta">
            <span className="ks-title">Kill switch</span>
            <span className="ks-sub">
              {conn.killSwitch
                ? 'Blocks all traffic if the VPN drops'
                : 'Off — traffic can leak if the VPN drops'}
            </span>
          </span>
          <span className={`ks-track ${conn.killSwitch ? 'on' : ''}`}>
            <span className="ks-thumb" />
          </span>
        </button>

        {connected && <StatBar tunnel={conn.tunnel} speed={conn.speed} pingMs={conn.pingMs} />}

        {conn.error && !conn.blocked && <div className="err">{conn.error}</div>}
      </div>

      <div className="shell-foot">
        <RecoveryNudge
          entitlement={conn.entitlement}
          onShowKey={() => {
            setRevealKey(true);
            setShowSettings(true);
          }}
        />
        <TierBadge entitlement={conn.entitlement} onUpgrade={() => setShowUpgrade(true)} />

        {connected || busy || conn.blocked || conn.disconnecting ? (
          <button className="btn-disc" onClick={conn.disconnect} disabled={conn.disconnecting}>
            {conn.disconnecting ? 'Disconnecting…' : 'Disconnect'}
          </button>
        ) : (
          <button
            className="btn-primary"
            onClick={conn.connect}
            disabled={
              !selected ||
              !ready ||
              conn.phase === 'loading' ||
              (conn.multihop && conn.routeStyle === 'multihop-cross-jurisdiction' && !conn.exit)
            }
          >
            {conn.phase === 'loading'
              ? 'Loading…'
              : conn.helperState === 'serviceStarting'
                ? 'Starting…'
                : conn.multihop
                  ? 'Connect · multi-hop'
                  : 'Connect'}
          </button>
        )}
      </div>

      {picker !== null && (
        <CountryPicker
          countries={conn.countries}
          {...(picker === 'exit'
            ? { selectedId: conn.exit?.code ?? null, onPick: conn.selectExit }
            : {
                locations: conn.locations,
                selectedId: conn.automatic
                  ? null
                  : selected
                    ? (selected.id ?? selected.code)
                    : null,
                onPick: conn.select,
                onPickAutomatic: () => conn.select(null),
              })}
          onClose={() => setPicker(null)}
          onRefresh={conn.refresh}
          favorites={conn.favorites}
          onToggleFavorite={conn.toggleFavorite}
        />
      )}

      {showSettings && (
        <Settings
          autoConnect={conn.autoConnect}
          killSwitch={conn.killSwitch}
          stealth={conn.transportMode === 'stealth'}
          tier={conn.entitlement?.tier ?? 'free'}
          paidUntil={conn.entitlement?.paidUntil ?? null}
          nodeDiversity={conn.nodeDiversity}
          notifications={conn.notifications}
          sessionActive={conn.phase === 'connected' || conn.phase === 'connecting'}
          onNodeDiversity={conn.setNodeDiversity}
          onNotifications={conn.setNotifications}
          onAutoConnect={conn.setAutoConnect}
          onKillSwitch={conn.setKillSwitch}
          onStealth={(v) => conn.setTransportMode(v ? 'stealth' : 'auto')}
          onOpenUpgrade={() => setShowUpgrade(true)}
          revealRecoveryKey={revealKey}
          updater={update}
          onClose={() => {
            setShowSettings(false);
            setRevealKey(false);
          }}
        />
      )}

      {/* After Settings so it stacks on top: closing it returns to Settings. */}
      {showUpgrade && (
        <Upgrade
          entitlement={conn.entitlement}
          payment={conn.payment}
          refreshTier={conn.refreshTier}
          onClose={() => setShowUpgrade(false)}
        />
      )}
    </div>
  );
}
