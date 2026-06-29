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
        className="h-8 px-2 text-xs rounded-lg bg-[var(--neo-bg)] text-[var(--foreground)] shadow-[2px_2px_4px_var(--neo-shadow-dark),-2px_-2px_4px_var(--neo-shadow-light)] hover:shadow-[3px_3px_6px_var(--neo-shadow-dark),-3px_-3px_6px_var(--neo-shadow-light)] focus:outline-none focus:ring-2 focus:ring-red-500/60 cursor-pointer transition-shadow"
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
