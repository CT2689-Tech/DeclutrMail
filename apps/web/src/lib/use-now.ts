'use client';

/**
 * `useNow` — a render-safe "current time" for relative-time labels.
 *
 * Calling `Date.now()` in a render body hands the server render and client
 * hydration different clocks. The shared `null` server/first-client
 * snapshot keeps that first markup deterministic; the real clock appears
 * after mount as an ordinary state update.
 *
 * An optional refresh interval supports labels that must age while a tab
 * stays open. Callers that only need a hydration-safe local timestamp omit
 * it and pay one post-mount update.
 */

import { useEffect, useState } from 'react';

export function useNow(refreshIntervalMs?: number): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    if (refreshIntervalMs === undefined) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), refreshIntervalMs);
    return () => window.clearInterval(timer);
  }, [refreshIntervalMs]);
  return now;
}
