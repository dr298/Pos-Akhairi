// apps/web/src/lib/i18n.ts
//
// Sprint 9.8 — Minimal in-house i18n. Indonesian (id) is the default;
// English (en) is available as a secondary locale.
//
// Why custom (not next-intl)?
//   The brief allows a "simpler path: just create the JSON files + a
//   `useT()` hook that uses the JSON. Pages can opt-in." next-intl is
//   installed (see apps/web/package.json) and wired for users who want
//   server-side locale routing + middleware, but the *default* opt-in
//   path is this hook, which avoids breaking the existing locale-less
//   `/pos/*` routes.
//
// Locale resolution order (first match wins):
//   1. `pos_locale` cookie (set by the LanguageSwitcher)
//   2. `localStorage.getItem('pos_locale')`
//   3. `navigator.language` (browser) — matches if it starts with 'en'
//   4. Default: 'id' (Indonesian)
//
// API:
//   import { useT, useLocale, setLocale } from '@/lib/i18n';
//   const t = useT();
//   t('nav.order'); // → "Order" / "Order" (depending on locale)
//   setLocale('en'); // changes cookie + reloads
//
// Both functions work on the client only (this is a client-side hook —
// SSR pages would need the next-intl setup).

'use client';

import { useCallback, useEffect, useState } from 'react';
import id from '@/messages/id.json';
import en from '@/messages/en.json';

export type Locale = 'id' | 'en';

export const SUPPORTED_LOCALES: ReadonlyArray<Locale> = ['id', 'en'];
export const DEFAULT_LOCALE: Locale = 'id';

const LOCALE_COOKIE = 'pos_locale';
const LOCALE_STORAGE_KEY = 'pos_locale';
// 1 year. Locale preference is sticky.
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const messages: Record<Locale, Record<string, unknown>> = {
  id: id as Record<string, unknown>,
  en: en as Record<string, unknown>,
};

function isSupported(value: string | null | undefined): value is Locale {
  return !!value && (SUPPORTED_LOCALES as ReadonlyArray<string>).includes(value);
}

function detectFromNavigator(): Locale {
  if (typeof navigator === 'undefined') return DEFAULT_LOCALE;
  const lang = navigator.language || (navigator as { userLanguage?: string }).userLanguage;
  if (!lang) return DEFAULT_LOCALE;
  const lower = lang.toLowerCase();
  if (lower.startsWith('en')) return 'en';
  if (lower.startsWith('id')) return 'id';
  return DEFAULT_LOCALE;
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const cookies = document.cookie ? document.cookie.split(';') : [];
  for (const c of cookies) {
    const trimmed = c.trim();
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const k = trimmed.slice(0, eq);
    if (k === name) {
      return decodeURIComponent(trimmed.slice(eq + 1));
    }
  }
  return null;
}

function writeCookie(name: string, value: string, maxAgeSec: number): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAgeSec}; samesite=lax`;
}

function readStorage(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore (e.g. private mode / quota)
  }
}

export function resolveLocale(): Locale {
  // 1. cookie
  const cookie = readCookie(LOCALE_COOKIE);
  if (isSupported(cookie)) return cookie;
  // 2. localStorage
  const stored = readStorage(LOCALE_STORAGE_KEY);
  if (isSupported(stored)) return stored;
  // 3. navigator
  return detectFromNavigator();
}

export function setLocale(value: Locale): void {
  writeCookie(LOCALE_COOKIE, value, COOKIE_MAX_AGE);
  writeStorage(LOCALE_STORAGE_KEY, value);
}

// ─── Core t() implementation ───────────────────────────────────────────────

type DotPath = ReadonlyArray<string>;

function getByPath(obj: Record<string, unknown>, path: DotPath): unknown {
  let cur: unknown = obj;
  for (const seg of path) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function formatFallback(value: string, params?: Record<string, string | number>): string {
  if (!params) return value;
  // Tiny {name}-style substitution. Avoid pulling in a templating lib.
  return value.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const v = params[key];
    return v === undefined || v === null ? `{${key}}` : String(v);
  });
}

/**
 * Look up a translation by dot-path. Falls back to:
 *   1. The other locale's message (if the key exists there)
 *   2. The raw key (so missing keys are visible during dev)
 */
function lookup(locale: Locale, key: string, params?: Record<string, string | number>): string {
  const path = key.split('.');
  // Try requested locale
  const primary = getByPath(messages[locale], path);
  if (typeof primary === 'string') return formatFallback(primary, params);
  // Fall back to default
  if (locale !== DEFAULT_LOCALE) {
    const fallback = getByPath(messages[DEFAULT_LOCALE], path);
    if (typeof fallback === 'string') return formatFallback(fallback, params);
  }
  // Last resort: return the key so it's obvious in dev
  return key;
}

// ─── React hooks ──────────────────────────────────────────────────────────

/**
 * Subscribe to the current locale. Reads once on mount and re-reads when
 * the `pos_locale` cookie changes (we listen via a custom event the
 * switcher fires, and also poll storage events for cross-tab sync).
 */
export function useLocale(): Locale {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  useEffect(() => {
    setLocaleState(resolveLocale());
    const onChange = () => setLocaleState(resolveLocale());
    window.addEventListener('pos_locale_changed', onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener('pos_locale_changed', onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);
  return locale;
}

/**
 * The translation function. Returns a `t(key, params?)` callable that
 * always renders the *current* locale at call time — so the same hook
 * reference can be reused after the user switches language.
 *
 * Usage:
 *   const t = useT();
 *   <h1>{t('waste.title')}</h1>
 *   <p>{t('waste.form.reasonPlaceholder')}</p>
 *   <button>{t('common.save')}</button>
 */
export function useT(): (key: string, params?: Record<string, string | number>) => string {
  const locale = useLocale();
  return useCallback(
    (key: string, params?: Record<string, string | number>) => lookup(locale, key, params),
    [locale],
  );
}

/**
 * Imperative setter that also broadcasts a `pos_locale_changed` event so
 * every `useT` in the app picks up the change without a full page reload.
 */
export function useSetLocale(): (value: Locale) => void {
  return useCallback((value: Locale) => {
    setLocale(value);
    try {
      window.dispatchEvent(new Event('pos_locale_changed'));
    } catch {
      // ignore (e.g. SSR / very old browser)
    }
  }, []);
}
