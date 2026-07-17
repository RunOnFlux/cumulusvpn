import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CopyField } from './CopyField';

describe('<CopyField />', () => {
  it('renders the label, value and a copy affordance', () => {
    render(<CopyField label="Public key" value="abc123=" />);
    expect(screen.getByText('Public key')).toBeInTheDocument();
    expect(screen.getByText('abc123=')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Copy' });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('type', 'button');
  });
});
