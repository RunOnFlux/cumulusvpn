import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const invoke = vi.fn<(cmd: string) => Promise<void>>(() => Promise.resolve());
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string) => invoke(cmd),
  isTauri: () => true,
}));

const { QuitRow } = await import('./QuitRow');

beforeEach(() => {
  invoke.mockClear();
});

describe('<QuitRow />', () => {
  it('quits at once when not connected', () => {
    render(<QuitRow connected={false} />);
    fireEvent.click(screen.getByRole('button', { name: /Quit CumulusVPN/ }));
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('popover_quit');
  });

  it('asks first while connected, and Cancel keeps the app running', () => {
    render(<QuitRow connected />);
    fireEvent.click(screen.getByRole('button', { name: /Quit CumulusVPN/ }));
    expect(invoke).not.toHaveBeenCalled();
    expect(screen.getByText('Disconnect and quit?')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(invoke).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Quit CumulusVPN/ })).toBeTruthy();
  });

  it('quits after confirming while connected', () => {
    render(<QuitRow connected />);
    fireEvent.click(screen.getByRole('button', { name: /Quit CumulusVPN/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Quit' }));
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('popover_quit');
  });

  it('quits at once if the VPN went down while the question was showing', () => {
    const { rerender } = render(<QuitRow connected />);
    fireEvent.click(screen.getByRole('button', { name: /Quit CumulusVPN/ }));
    rerender(<QuitRow connected={false} />);
    fireEvent.click(screen.getByRole('button', { name: /Quit CumulusVPN/ }));
    expect(invoke).toHaveBeenCalledWith('popover_quit');
  });
});
