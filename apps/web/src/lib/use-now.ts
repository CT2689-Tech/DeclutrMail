'use client';

/**
 * `useNow` — a render-safe "current time" for relative-time labels.
 *
 * Calling `Date.now()` in a render body hands the server render and the
 * client hydration two different clocks, so a label like "synced 3m ago"
 * can hydrate-mismatch whenever the two straddle a unit boundary
 * (FOUNDER-FOLLOWUPS 2026-07-16). This hook keeps the first client
 * render's value stable for the whole render (lazy `useState` init), then
 * corrects once on mount — after which updates are ordinary state
 * changes, which React never warn about.
 *
 * Residual: the initial client render still computes its own clock, so a
 * mismatch remains possible in the millisecond the two renders straddle a
 * label boundary — strictly rarer than the per-render call it replaces,
 * and these surfaces render client-fetched data behind skeletons anyway.
 *
 * NOT a ticker: the value updates on mount, not on an interval. Surfaces
 * that need live ticking own their own interval state.
 */

import { useEffect, useState } from 'react';

export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
  }, []);
  return now;
}
