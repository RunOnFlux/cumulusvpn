import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatBar } from './StatBar';
import type { TunnelStatus } from '../lib/tauri';

function status(overrides: Partial<TunnelStatus>): TunnelStatus {
  return {
    state: 'up',
    endpoint: '198.51.100.2:51820',
    assignedIp: '10.8.0.2',
    country: 'DE',
    rxBytes: 0,
    txBytes: 0,
    lastHandshake: null,
    error: null,
    ...overrides,
  };
}

describe('<StatBar />', () => {
  it('renders the three stat labels', () => {
    render(<StatBar tunnel={status({})} />);
    expect(screen.getByText('Downloaded')).toBeInTheDocument();
    expect(screen.getByText('Uploaded')).toBeInTheDocument();
    expect(screen.getByText('Handshake')).toBeInTheDocument();
  });

  it('humanises byte counters and a missing handshake', () => {
    render(
      <StatBar tunnel={status({ rxBytes: 5 * 1024 * 1024, txBytes: 512, lastHandshake: null })} />,
    );
    expect(screen.getByText('5.0 MB')).toBeInTheDocument();
    expect(screen.getByText('512 B')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
