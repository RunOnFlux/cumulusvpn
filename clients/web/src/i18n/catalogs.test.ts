import { describe, expect, it } from 'vitest';
import type { Catalog, Locale, Message, Params } from './index';
import { formatRich, SUPPORTED_LOCALES } from './index';
import { en } from './locales/en';
import { es } from './locales/es';
import { pt } from './locales/pt';
import { fr } from './locales/fr';
import { de } from './locales/de';
import { it as itC } from './locales/it';
import { nl } from './locales/nl';
import { pl } from './locales/pl';
import { el } from './locales/el';
import { uk } from './locales/uk';
import { ru } from './locales/ru';
import { tr } from './locales/tr';
import { sv } from './locales/sv';
import { da } from './locales/da';
import { nb } from './locales/nb';
import { fi } from './locales/fi';
import { ar } from './locales/ar';
import { fa } from './locales/fa';
import { sw } from './locales/sw';
import { hi } from './locales/hi';
import { id } from './locales/id';
import { th } from './locales/th';
import { vi } from './locales/vi';
import { zh } from './locales/zh';
import { ja } from './locales/ja';
import { ko } from './locales/ko';

export const ALL_CATALOGS: Record<Locale, Catalog> = {
  en, es, pt, fr, de, it: itC, nl, pl, el, uk, ru, tr, sv, da, nb, fi,
  ar, fa, sw, hi, id, th, vi, zh, ja, ko,
};

/** Dummy params for every {placeholder} a message mentions (n gets a number). */
function dummyParams(msg: Message): Params {
  const text = typeof msg === 'string' ? msg : Object.values(msg).join(' ');
  const params: Params = {};
  for (const m of text.matchAll(/\{(\w+)\}/g)) {
    params[m[1]!] = m[1] === 'n' ? 3 : 'x';
  }
  return params;
}

// Every tag resolves to its label, so residual <...> markers mean a typo.
const permissiveHandlers = new Proxy(
  {},
  { get: () => (label: string) => label },
) as Record<string, (label: string) => string>;

describe('catalog sweep', () => {
  for (const locale of SUPPORTED_LOCALES) {
    const catalog = ALL_CATALOGS[locale];
    it(`${locale}: every message resolves cleanly`, () => {
      const allowed = new Set([...new Intl.PluralRules(locale).resolvedOptions().pluralCategories, 'other']);
      for (const key of Object.keys(en) as (keyof typeof en)[]) {
        const msg = catalog[key];
        if (typeof msg !== 'string') {
          expect(msg.other, `${locale}.${key} needs other`).toBeTypeOf('string');
          for (const cat of Object.keys(msg)) {
            expect(allowed.has(cat), `${locale}.${key} has impossible category ${cat}`).toBe(true);
          }
        }
        const rendered = formatRich(catalog, locale, key, permissiveHandlers, dummyParams(msg))
          .map(String)
          .join('');
        expect(rendered, `${locale}.${key} leaks a placeholder`).not.toMatch(/\{\w+\}/);
        expect(rendered, `${locale}.${key} leaks a tag`).not.toMatch(/<\/?\w+/);
      }
    });
  }
});
