'use client';

import { useLocale, useSetLocale, SUPPORTED_LOCALES, type Locale } from '@/lib/i18n';

/**
 * Sprint 9.8 — Tiny dropdown for switching UI language. Lives in the
 * header next to the user info block. The current locale is reflected
 * back via the cookie + localStorage, so the choice persists across
 * reloads and is shared across tabs.
 */
export function LanguageSwitcher() {
  const current = useLocale();
  const setLocale = useSetLocale();

  return (
    <div className="relative inline-flex items-center" aria-label="Language switcher">
      <label className="sr-only" htmlFor="pos-locale-select">
        Language
      </label>
      <select
        id="pos-locale-select"
        value={current}
        onChange={(e) => setLocale(e.target.value as Locale)}
        className="h-8 px-2 text-xs rounded-md bg-neutral-900 border border-neutral-700 text-neutral-200 hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-red-500/60 cursor-pointer"
      >
        {SUPPORTED_LOCALES.map((l) => (
          <option key={l} value={l}>
            {l === 'id' ? '🇮🇩 ID' : '🇬🇧 EN'}
          </option>
        ))}
      </select>
    </div>
  );
}
