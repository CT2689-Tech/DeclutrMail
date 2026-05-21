'use client';

import { useEffect, useState } from 'react';
import { breakpoint } from '../tokens/tokens';

export type Breakpoint = keyof typeof breakpoint;

/**
 * True when the viewport width is at most the named breakpoint ceiling.
 * SSR-safe: returns false until the matchMedia listener attaches on mount.
 */
export function useIsAtMost(bp: Breakpoint): boolean {
  const limit = breakpoint[bp];
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${limit}px)`);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [limit]);

  return matches;
}
