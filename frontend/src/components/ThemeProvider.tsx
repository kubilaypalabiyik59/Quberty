'use client';

import * as React from 'react';

/**
 * Theme state for the whole product.
 *
 * Three states, not two. "system" is the default and is not the same as light:
 * it follows the OS and keeps following it when the OS changes. Only an explicit
 * choice by the user is persisted.
 *
 * The class on <html> is what Tailwind's `darkMode: 'class'` reads. The
 * inline script in the layout applies it before first paint; this provider only
 * keeps it in sync afterwards.
 */

export type ThemeChoice = 'light' | 'dark' | 'system';
type Resolved = 'light' | 'dark';

const STORAGE_KEY = 'quberty-theme';

interface ThemeContextValue {
  /** What the user picked. */
  theme: ThemeChoice;
  /** What is actually on screen right now. */
  resolved: Resolved;
  setTheme: (t: ThemeChoice) => void;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

function systemPrefers(): Resolved {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function apply(resolved: Resolved) {
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<ThemeChoice>('system');
  const [resolved, setResolved] = React.useState<Resolved>('light');

  // Read the stored choice once mounted. Before this runs the inline script has
  // already painted the right theme, so there is no flash to correct.
  React.useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY) as ThemeChoice | null;
    const next = stored ?? 'system';
    setThemeState(next);
    const r = next === 'system' ? systemPrefers() : next;
    setResolved(r);
    apply(r);
  }, []);

  // Keep following the OS while the choice is "system".
  React.useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const r = mq.matches ? 'dark' : 'light';
      setResolved(r);
      apply(r);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  const setTheme = React.useCallback((next: ThemeChoice) => {
    setThemeState(next);
    if (next === 'system') {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
    const r = next === 'system' ? systemPrefers() : next;
    setResolved(r);
    apply(r);
  }, []);

  const value = React.useMemo(() => ({ theme, resolved, setTheme }), [theme, resolved, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}

/**
 * Runs before React hydrates, so the correct ground is painted on the very
 * first frame. Without it the page flashes light before switching to dark.
 */
export const themeBootstrapScript = `
(function(){try{
  var c = localStorage.getItem('${STORAGE_KEY}');
  var d = c === 'dark' || (!c && matchMedia('(prefers-color-scheme: dark)').matches);
  var r = document.documentElement;
  if (d) r.classList.add('dark');
  r.style.colorScheme = d ? 'dark' : 'light';
}catch(e){}})();
`;
