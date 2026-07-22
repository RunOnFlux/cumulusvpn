import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LOCALE_STORAGE_KEY } from '../config';
import { LocaleProvider, useI18n } from './useLocale';
import { Header } from '../components/Header';

function Probe() {
  const { locale, t } = useI18n();
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="msg">{t('connect_choose_location')}</span>
    </div>
  );
}

describe('LocaleProvider', () => {
  it('defaults to en and serves English messages', () => {
    render(
      <LocaleProvider initialLocale="en">
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByTestId('locale')).toHaveTextContent('en');
    expect(screen.getByTestId('msg')).toHaveTextContent('Choose a location');
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.hasAttribute('dir')).toBe(false);
  });

  it('honours a stored locale over detection', () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de');
    render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByTestId('locale')).toHaveTextContent('de');
  });

  it('ignores an invalid stored value', () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'klingon');
    render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByTestId('locale')).toHaveTextContent('en');
  });

  it('stamps dir=rtl for Arabic and updates document.title', async () => {
    render(
      <LocaleProvider initialLocale="ar">
        <Probe />
      </LocaleProvider>,
    );
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.title).not.toBe('');
  });
});

describe('<Header /> language switcher', () => {
  it('lists all locales, switches language, and persists the choice', () => {
    render(
      <LocaleProvider initialLocale="en">
        <Header route="connect" onNavigate={() => {}} themeMode="system" onToggleTheme={() => {}} />
      </LocaleProvider>,
    );
    const select = screen.getByRole('combobox', { name: 'Language' });
    expect(select.querySelectorAll('option')).toHaveLength(26);
    fireEvent.change(select, { target: { value: 'de' } });
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('de');
    expect(document.documentElement.lang).toBe('de');
  });
});
