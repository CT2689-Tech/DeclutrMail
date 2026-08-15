'use client';

// Theme resolver for the two ROOT-level surfaces that no route group
// owns: `app/not-found.tsx` and `app/error.tsx`.
//
// Every other page gets `<ThemeScript>` from its route group. These two
// cannot, and the reason is a genuine CSP corner: an unmatched URL under
// an authed path (`/triage/gone`) falls through to the ROOT not-found,
// where middleware has already applied the strict nonce +
// 'strict-dynamic' policy — under which an un-nonced `<script src>` is
// refused. Emitting an un-nonced tag there would log a CSP violation on
// exactly the surface a confused user is already looking at, and reading
// the nonce to avoid that would make the root not-found dynamic, which
// un-statics all 34 public pages (Option A′, founder 2026-08-14).
//
// Bundled module code sidesteps the question entirely: it is not an
// inline script and not an un-nonced external one, so it runs under BOTH
// policies. The cost is that it applies AFTER hydration rather than
// before paint — a dark-preference visitor sees one light frame on a 404
// or an error page. That is the correct surface to pay it on: nothing is
// being read carefully or decided there, and the alternative is either a
// console violation or a slow public site.
//
// Duplicates the resolution rule in `public/theme-init.js` and
// `theme.ts` — a third copy, deliberately, because a static asset cannot
// import. Keep all three in step (storage key, then OS preference).

import { useEffect } from 'react';

import { isFeatureEnabled } from '@/lib/flags';
import { THEME_STORAGE_KEY } from './theme';

export function ThemeFallback() {
  useEffect(() => {
    // Flag off ⇒ never set `data-theme`, so the surface renders light —
    // identical to what `<ThemeScript>` does (ADR-0025 kill-switch).
    if (!isFeatureEnabled('darkMode')) return;
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(THEME_STORAGE_KEY);
    } catch {
      // Private mode / quota — fall through to the OS preference, the
      // same branch `theme-init.js` takes.
    }
    const theme =
      stored === 'light' || stored === 'dark'
        ? stored
        : window.matchMedia?.('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light';
    document.documentElement.setAttribute('data-theme', theme);
  }, []);

  return null;
}
