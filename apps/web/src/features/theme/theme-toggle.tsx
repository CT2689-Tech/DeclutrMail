'use client';

/**
 * ThemeToggle — light/dark switch for the app topbar.
 *
 * Lives in `AppShell.topbarRight` next to SyncNowButton. One click
 * flips the resolved theme and persists it (features/theme/theme.ts);
 * the first-ever visit follows the OS preference until the user picks.
 *
 * Icon-only + `aria-pressed` — the label says what a press DOES
 * ("Switch to dark mode"), not the current state, so screen readers
 * hear the action.
 */

import { useEffect, useState } from 'react';
import { tokens } from '@declutrmail/shared';
import { getResolvedTheme, setTheme, type Theme } from './theme';

const { color } = tokens;

export function ThemeToggle() {
  // `null` until mounted — the server can't know the resolved theme,
  // so render a neutral placeholder first and let the client fill in
  // the real icon post-hydration (avoids a hydration mismatch).
  const [theme, setThemeState] = useState<Theme | null>(null);
  useEffect(() => {
    setThemeState(getResolvedTheme());
  }, []);

  const dark = theme === 'dark';
  const flip = () => {
    const next: Theme = dark ? 'light' : 'dark';
    setTheme(next);
    setThemeState(next);
  };

  return (
    <button
      type="button"
      onClick={flip}
      aria-pressed={dark}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 30,
        height: 30,
        borderRadius: 8,
        border: `1px solid ${color.border}`,
        background: color.card,
        color: color.fgSoft,
        cursor: 'pointer',
        padding: 0,
      }}
    >
      {theme === null ? (
        // Pre-hydration placeholder — same box, no icon.
        <span aria-hidden style={{ width: 14, height: 14 }} />
      ) : dark ? (
        // Sun — pressing returns to light.
        <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="4.4" stroke="currentColor" strokeWidth="1.8" />
          <path
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7"
          />
        </svg>
      ) : (
        // Moon — pressing goes dark.
        <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path
            d="M20.2 14.1A8.3 8.3 0 0 1 9.9 3.8a8.3 8.3 0 1 0 10.3 10.3Z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}
