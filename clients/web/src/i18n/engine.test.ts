import { describe, expect, it } from 'vitest';
import type { Message } from './messages';
import { detectLocale, formatMessage, formatRich, isLocale, SUPPORTED_LOCALES } from './engine';

const CATALOG: Record<string, Message> = {
  plain: 'Choose a location',
  interp: 'No gateway in {country} via {proto}',
  nodes: { one: '{n} node', other: '{n} nodes' },
  ru_nodes: { one: '{n} узел', few: '{n} узла', many: '{n} узлов', other: '{n} узла' },
  ar_days: { zero: 'z', one: 'o', two: 't', few: 'f', many: 'm', other: 'x' },
  rich: 'Free at 100 KB/s; <up>upgrade</up> now',
  rich_repeat: '<b>A</b> mid <b>B</b> end {p}<br/>tail',
};

describe('detectLocale', () => {
  it('matches exact and case-insensitive tags', () => {
    expect(detectLocale(['de'])).toBe('de');
    expect(detectLocale(['DE'])).toBe('de');
  });
  it('matches by language prefix', () => {
    expect(detectLocale(['pt-BR'])).toBe('pt');
    expect(detectLocale(['zh-TW'])).toBe('zh');
  });
  it('maps legacy aliases', () => {
    expect(detectLocale(['no'])).toBe('nb');
    expect(detectLocale(['nn-NO'])).toBe('nb');
    expect(detectLocale(['in'])).toBe('id');
  });
  it('falls through unsupported tags to en', () => {
    expect(detectLocale(['am', 'xx-YY'])).toBe('en');
    expect(detectLocale([])).toBe('en');
  });
  it('prefers the first supported entry', () => {
    expect(detectLocale(['am', 'fr', 'de'])).toBe('fr');
  });
});

describe('isLocale', () => {
  it('accepts every supported locale and rejects others', () => {
    for (const l of SUPPORTED_LOCALES) expect(isLocale(l)).toBe(true);
    expect(isLocale('xx')).toBe(false);
    expect(isLocale(42)).toBe(false);
  });
});

describe('formatMessage', () => {
  it('returns plain strings verbatim', () => {
    expect(formatMessage(CATALOG, 'en', 'plain')).toBe('Choose a location');
  });
  it('interpolates {params}', () => {
    expect(formatMessage(CATALOG, 'en', 'interp', { country: 'Germany', proto: 'http' })).toBe(
      'No gateway in Germany via http',
    );
  });
  it('leaves unknown placeholders intact and unknown keys become the key', () => {
    expect(formatMessage(CATALOG, 'en', 'interp', { country: 'X' })).toBe(
      'No gateway in X via {proto}',
    );
    expect(formatMessage(CATALOG, 'en', 'missing_key')).toBe('missing_key');
  });
  it('selects English plurals on n', () => {
    expect(formatMessage(CATALOG, 'en', 'nodes', { n: 1 })).toBe('1 node');
    expect(formatMessage(CATALOG, 'en', 'nodes', { n: 4 })).toBe('4 nodes');
  });
  it('selects Russian one/few/many', () => {
    expect(formatMessage(CATALOG, 'ru', 'ru_nodes', { n: 1 })).toBe('1 узел');
    expect(formatMessage(CATALOG, 'ru', 'ru_nodes', { n: 3 })).toBe('3 узла');
    expect(formatMessage(CATALOG, 'ru', 'ru_nodes', { n: 5 })).toBe('5 узлов');
    expect(formatMessage(CATALOG, 'ru', 'ru_nodes', { n: 21 })).toBe('21 узел');
  });
  it('selects all six Arabic categories', () => {
    const at = (n: number) => formatMessage(CATALOG, 'ar', 'ar_days', { n });
    expect(at(0)).toBe('z');
    expect(at(1)).toBe('o');
    expect(at(2)).toBe('t');
    expect(at(3)).toBe('f');
    expect(at(11)).toBe('m');
    expect(at(100)).toBe('x');
  });
  it('falls back to other when a category is missing', () => {
    expect(formatMessage(CATALOG, 'ru', 'nodes', { n: 3 })).toBe('3 nodes');
  });
});

describe('formatRich', () => {
  it('substitutes tag handlers and keeps surrounding text', () => {
    const parts = formatRich(CATALOG, 'en', 'rich', { up: (label) => `[${label}]` });
    expect(parts.join('')).toBe('Free at 100 KB/s; [upgrade] now');
  });
  it('handles repeated tags, void tags, and params', () => {
    const parts = formatRich(
      CATALOG,
      'en',
      'rich_repeat',
      { b: (label) => `(${label})`, br: () => '|' },
      { p: 'P' },
    );
    expect(parts.join('')).toBe('(A) mid (B) end P|tail');
  });
  it('leaves unhandled tags as literal text', () => {
    const parts = formatRich(CATALOG, 'en', 'rich', {});
    expect(parts.join('')).toBe('Free at 100 KB/s; <up>upgrade</up> now');
  });
});
