import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LocaleProvider } from '../hooks/useLocale';
import { CopyField } from './CopyField';

describe('<CopyField />', () => {
  it('renders the label, value and a copy affordance', () => {
    render(
      <LocaleProvider initialLocale="en">
        <CopyField label="Public key" value="abc123=" />
      </LocaleProvider>,
    );
    expect(screen.getByText('Public key')).toBeInTheDocument();
    expect(screen.getByText('abc123=')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Copy' });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('type', 'button');
  });
});
