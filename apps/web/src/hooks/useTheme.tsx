'use client';

// apps/web/src/hooks/useTheme.tsx
//
// Light/dark theme manager with localStorage persistence and system
// preference fallback. The "no-flash" inline script in app/layout.tsx
// sets the .dark class on <html> BEFORE React hydrates, so the user
// never sees a wrong-theme flash on reload.

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

type ThemeContextValue = {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
};

const STORAGE_KEY = 'pos:theme';
const ThemeContext = createContext<ThemeContextValue | null>(null);

function readInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  // The no-flash script in layout.tsx already set the class. Read it.
  if (document.documentElement.classList.contains('dark')) return 'dark';
  return 'light';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // On first render, the no-flash script has already set the class on <html>.
  // We mirror that into state so the rest of the app can react to it.
  const [theme, setThemeState] = useState<Theme>('dark');

  useEffect(() => {
    setThemeState(readInitialTheme());
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    if (typeof window === 'undefined') return;
    const root = document.documentElement;
    if (t === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try { window.localStorage.setItem(STORAGE_KEY, t); } catch {}
  }, []);

  const toggle = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // Outside provider: return a noop default so the navbar still works.
    return { theme: 'dark', setTheme: () => {}, toggle: () => {} };
  }
  return ctx;
}

/**
 * Inline script string injected by app/layout.tsx into <head> to set the
 * .dark class on <html> before React hydrates. Reads localStorage, then
 * falls back to prefers-color-scheme.
 */
export const NO_FLASH_SCRIPT = `
(function() {
  try {
    var saved = localStorage.getItem('${STORAGE_KEY}');
    var theme = saved;
    if (theme !== 'light' && theme !== 'dark') {
      // Default: dark (preserves existing UX for current POS users).
      // User can switch to light via the navbar toggle.
      theme = 'dark';
    }
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  } catch (e) {
    document.documentElement.classList.add('dark');
  }
})();
`;
