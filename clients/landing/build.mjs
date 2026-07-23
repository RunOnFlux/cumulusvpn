#!/usr/bin/env node
// Zero-dependency generator for the localized landing site.
// Usage:  node build.mjs            regenerate public/ from src/
//         node build.mjs --check    verify committed output (extended in later tasks)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url)); // clients/landing
const SRC = join(ROOT, 'src');
const PUB = join(ROOT, 'public');
const ORIGIN = 'https://cumulusvpn.com';

// Canonical registry — array order is switcher order. `og` is og:locale.
export const LOCALES = [
  { code: 'en', endonym: 'English', og: 'en_US' },
  { code: 'es', endonym: 'Español', og: 'es_ES' },
  { code: 'pt', endonym: 'Português', og: 'pt_BR' },
  { code: 'fr', endonym: 'Français', og: 'fr_FR' },
  { code: 'de', endonym: 'Deutsch', og: 'de_DE' },
  { code: 'it', endonym: 'Italiano', og: 'it_IT' },
  { code: 'nl', endonym: 'Nederlands', og: 'nl_NL' },
  { code: 'pl', endonym: 'Polski', og: 'pl_PL' },
  { code: 'el', endonym: 'Ελληνικά', og: 'el_GR' },
  { code: 'uk', endonym: 'Українська', og: 'uk_UA' },
  { code: 'ru', endonym: 'Русский', og: 'ru_RU' },
  { code: 'tr', endonym: 'Türkçe', og: 'tr_TR' },
  { code: 'sv', endonym: 'Svenska', og: 'sv_SE' },
  { code: 'da', endonym: 'Dansk', og: 'da_DK' },
  { code: 'nb', endonym: 'Norsk', og: 'nb_NO' },
  { code: 'fi', endonym: 'Suomi', og: 'fi_FI' },
  { code: 'ar', endonym: 'العربية', og: 'ar_AR', rtl: true },
  { code: 'fa', endonym: 'فارسی', og: 'fa_IR', rtl: true },
  { code: 'sw', endonym: 'Kiswahili', og: 'sw_KE' },
  { code: 'hi', endonym: 'हिन्दी', og: 'hi_IN' },
  { code: 'id', endonym: 'Bahasa Indonesia', og: 'id_ID' },
  { code: 'th', endonym: 'ไทย', og: 'th_TH' },
  { code: 'vi', endonym: 'Tiếng Việt', og: 'vi_VN' },
  { code: 'zh', endonym: '中文', og: 'zh_CN' },
  { code: 'ja', endonym: '日本語', og: 'ja_JP' },
  { code: 'ko', endonym: '한국어', og: 'ko_KR' },
];

export const PAGES = [
  { slug: '', template: 'index.html', out: 'index.html' },
  { slug: 'support', template: 'support.html', out: 'support.html' },
  { slug: 'privacy', template: 'privacy.html', out: 'privacy.html' },
];

export const localeBase = (code) => (code === 'en' ? '/' : `/${code}/`);
export const pagePath = (code, slug) => localeBase(code) + slug;
export const pageUrl = (code, slug) => ORIGIN + pagePath(code, slug);

export function flatten(catalog) {
  const out = new Map();
  for (const [group, entries] of Object.entries(catalog)) {
    for (const [key, value] of Object.entries(entries)) out.set(`${group}.${key}`, value);
  }
  return out;
}

function loadCatalogs() {
  const map = new Map();
  for (const l of LOCALES) {
    const file = join(SRC, 'locales', `${l.code}.json`);
    if (existsSync(file)) map.set(l.code, flatten(JSON.parse(readFileSync(file, 'utf8'))));
  }
  return map;
}

export function render(templateText, locale, page, catalog, activeLocales) {
  let html = templateText.replace(/\{\{([a-z0-9_.]+)\}\}/g, (_, path) => {
    const val = catalog.get(path);
    if (typeof val !== 'string') throw new Error(`${locale.code}/${page.template}: missing catalog key ${path}`);
    return val;
  });
  const tokens = {
    '%HOME%': localeBase(locale.code),
    '%SUPPORT%': localeBase(locale.code) + 'support',
    '%PRIVACY%': localeBase(locale.code) + 'privacy',
    '%LANG%': locale.code,
    '%DIR%': locale.rtl ? ' dir="rtl"' : '',
    '%CANONICAL%': pageUrl(locale.code, page.slug),
    '%OG_LOCALE%': locale.og,
    '%ALTERNATES%': [
      ...activeLocales.map((l) => `<link rel="alternate" hreflang="${l.code}" href="${pageUrl(l.code, page.slug)}" />`),
      `<link rel="alternate" hreflang="x-default" href="${pageUrl('en', page.slug)}" />`,
    ].join('\n'),
    '%PAGE%': page.slug,
    '%LOCALE_OPTIONS%': activeLocales
      .map((l) => `<option value="${l.code}"${l.code === locale.code ? ' selected' : ''}>${l.endonym}</option>`)
      .join(''),
    '%REDIRECT_SCRIPT%':
      locale.code === 'en'
        ? `<script>(function(){try{var v=${JSON.stringify(activeLocales.map((l) => l.code))},s=localStorage.getItem('cumulusvpn-locale');if(s&&s!=='en'&&v.indexOf(s)>-1)location.replace('/'+s+'/${page.slug}');}catch(e){}})();</script>`
        : '',
    '%TRANSLATION_NOTE%':
      page.slug === 'privacy' && locale.code !== 'en'
        ? `\n  <p class="doc-meta">${catalog.get('privacy.translation_note')}</p>`
        : '',
  };
  html = html.replace(/%[A-Z_]{2,}%/g, (m) => {
    if (m in tokens) return tokens[m];
    throw new Error(`${locale.code}/${page.template}: unknown token ${m}`);
  });
  return html;
}

export function buildAll() {
  const catalogs = loadCatalogs();
  const active = LOCALES.filter((l) => catalogs.has(l.code));
  const out = new Map(); // relPath under public/ -> content
  for (const page of PAGES) {
    if (!existsSync(join(SRC, 'templates', page.template))) continue;
    const templateText = readFileSync(join(SRC, 'templates', page.template), 'utf8');
    for (const locale of active) {
      const rel = locale.code === 'en' ? page.out : `${locale.code}/${page.out}`;
      out.set(rel, render(templateText, locale, page, catalogs.get(locale.code), active));
    }
  }
  return { out, active, catalogs };
}

function sitemapXml(active) {
  const urls = [];
  for (const page of PAGES) {
    for (const l of active) {
      const links = [
        ...active.map((a) => `    <xhtml:link rel="alternate" hreflang="${a.code}" href="${pageUrl(a.code, page.slug)}" />`),
        `    <xhtml:link rel="alternate" hreflang="x-default" href="${pageUrl('en', page.slug)}" />`,
      ].join('\n');
      urls.push(`  <url>\n    <loc>${pageUrl(l.code, page.slug)}</loc>\n${links}\n  </url>`);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`;
}

function write() {
  const { out, active } = buildAll();
  for (const [rel, content] of out) {
    const file = join(PUB, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  writeFileSync(join(PUB, 'sitemap.xml'), sitemapXml(active));
  console.log(`landing i18n: wrote ${out.size} pages for ${active.length} locale(s)`);
}

const TAG_RE = /<([a-zA-Z][a-zA-Z0-9]*)/g;
const LINK_TOKEN_RE = /%(HOME|SUPPORT|PRIVACY)%/g;

function tagMultiset(s) {
  return (s.match(TAG_RE) ?? []).map((t) => t.slice(1).toLowerCase()).sort().join(',');
}
function linkTokens(s) {
  return [...new Set(s.match(LINK_TOKEN_RE) ?? [])].sort().join(',');
}

function check(allowMissing) {
  const errors = [];
  const { out, active, catalogs } = buildAll();

  // 1. Catalog presence (strict unless --allow-missing).
  const missing = LOCALES.filter((l) => !catalogs.has(l.code)).map((l) => l.code);
  if (missing.length && !allowMissing) errors.push(`missing catalogs: ${missing.join(' ')}`);

  // 2. Drift: committed output must equal a fresh build.
  for (const [rel, content] of out) {
    const file = join(PUB, rel);
    if (!existsSync(file)) errors.push(`drift: ${rel} missing on disk (run: node build.mjs)`);
    else if (readFileSync(file, 'utf8') !== content) errors.push(`drift: ${rel} differs from build output`);
  }
  // Stale locale dirs for locales without catalogs.
  for (const l of LOCALES) {
    if (!catalogs.has(l.code) && existsSync(join(PUB, l.code))) errors.push(`stale: public/${l.code}/ has no catalog`);
  }

  // 3. Placeholder/token leaks in rendered output.
  for (const [rel, content] of out) {
    const leak = content.match(/\{\{[a-z0-9_.]+\}\}|%[A-Z_]{2,}%/);
    if (leak) errors.push(`leak: ${rel} contains ${leak[0]}`);
  }

  // 4. Key parity + structural parity vs en.
  const en = catalogs.get('en');
  if (!en) errors.push('en.json missing — nothing to compare against');
  else {
    for (const [code, cat] of catalogs) {
      if (code === 'en') continue;
      for (const key of en.keys()) if (!cat.has(key)) errors.push(`${code}: missing key ${key}`);
      for (const key of cat.keys()) if (!en.has(key)) errors.push(`${code}: extra key ${key}`);
      for (const [key, val] of cat) {
        if (!en.has(key)) continue;
        if (tagMultiset(val) !== tagMultiset(en.get(key)))
          errors.push(`${code}: ${key} tag structure differs from en (${tagMultiset(val) || '∅'} vs ${tagMultiset(en.get(key)) || '∅'})`);
        if (linkTokens(val) !== linkTokens(en.get(key)))
          errors.push(`${code}: ${key} link tokens differ from en`);
      }
    }
  }

  // 5. JSON-LD must stay parseable on every generated homepage.
  for (const [rel, content] of out) {
    if (!rel.endsWith('index.html')) continue;
    const m = content.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    if (!m) { errors.push(`jsonld: ${rel} block missing`); continue; }
    try { JSON.parse(m[1]); } catch { errors.push(`jsonld: ${rel} is not valid JSON`); }
  }

  // 6. hreflang integrity: every page lists exactly active+x-default, correct doc.
  for (const page of PAGES) {
    const expected = new Set([...active.map((l) => pageUrl(l.code, page.slug)), pageUrl('en', page.slug)]);
    for (const l of active) {
      const rel = l.code === 'en' ? page.out : `${l.code}/${page.out}`;
      const found = [...out.get(rel).matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)" \/>/g)];
      if (found.length !== active.length + 1) errors.push(`hreflang: ${rel} has ${found.length}, want ${active.length + 1}`);
      for (const [, , href] of found) if (!expected.has(href)) errors.push(`hreflang: ${rel} stray href ${href}`);
    }
  }
  // 7. Sitemap: <loc> set == generated page URL set; drift vs disk.
  const expectedLocs = new Set(PAGES.flatMap((p) => active.map((l) => pageUrl(l.code, p.slug))));
  const sm = sitemapXml(active);
  const locs = new Set([...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));
  if (locs.size !== expectedLocs.size || [...locs].some((u) => !expectedLocs.has(u))) errors.push('sitemap: loc set mismatch');
  if (!existsSync(join(PUB, 'sitemap.xml')) || readFileSync(join(PUB, 'sitemap.xml'), 'utf8') !== sm) errors.push('sitemap: drift');

  if (errors.length) {
    for (const e of errors) console.error(`CHECK FAIL: ${e}`);
    process.exit(1);
  }
  console.log(`landing i18n: check passed (${out.size} pages, ${active.length} locale(s))`);
}

const args = process.argv.slice(2);
if (args.includes('--check')) check(args.includes('--allow-missing'));
else write();
