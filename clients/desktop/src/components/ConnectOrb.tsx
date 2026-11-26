import type { JSX, ReactNode } from 'react';
import type { Phase } from '../hooks/useConnection.js';
import { DotsIcon, PowerIcon } from './Icons.js';

interface Props {
  readonly phase: Phase;
  readonly onToggle: () => void;
  /** Kill switch holding traffic after a drop (see useConnection `blocked`). */
  readonly blocked?: boolean;
  /** A Disconnect is in progress (useConnection `disconnecting`). */
  readonly disconnecting?: boolean;
}

const LABEL: Record<Phase, string> = {
  loading: 'Loading',
  idle: 'Not connected',
  connecting: 'Connecting',
  connected: 'Protected',
  error: 'Error',
};

/** The big central connect state — cyan glow + pulse ring when protected. */
export function ConnectOrb({
  phase,
  onToggle,
  blocked = false,
  disconnecting = false,
}: Props): JSX.Element {
  const mode = disconnecting
    ? 'connecting'
    : blocked
      ? 'blocked'
      : phase === 'connected'
        ? 'on'
        : phase === 'connecting'
          ? 'connecting'
          : 'off';
  const glyph: ReactNode = disconnecting ? (
    <DotsIcon />
  ) : blocked ? (
    '⛔'
  ) : phase === 'connected' ? (
    '🛡️'
  ) : phase === 'connecting' ? (
    <DotsIcon />
  ) : (
    <PowerIcon />
  );
  const label = disconnecting ? 'Disconnecting' : blocked ? 'Blocked' : LABEL[phase];
  return (
    <div className="orb-wrap">
      <button
        className={`orb ${mode}`}
        onClick={onToggle}
        disabled={phase === 'loading' || phase === 'connecting' || disconnecting}
        aria-label={label}
      >
        <span className="ring" />
        <span className="core">
          <span className="glyph">{glyph}</span>
          <span className="state">{label}</span>
        </span>
      </button>
    </div>
  );
}
