'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * useState backed by localStorage. SSR-safe: the server (and the first
 * client render) use `initial`; the persisted value is read in an effect
 * after mount, so server and client markup match and there is no
 * hydration mismatch.
 */
export function useLocalState<T>(
  key: string,
  initial: T,
): [T, (next: T | ((prev: T) => T)) => void] {
  const storageKey = `dm.${key}`;
  const [value, setValue] = useState<T>(initial);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw != null) setValue(JSON.parse(raw) as T);
    } catch {
      // localStorage can be unavailable (private mode, disabled) — the
      // in-memory initial value is a fine fallback.
    }
  }, [storageKey]);

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(resolved));
        } catch {
          // Persistence is best-effort; ignore storage failures.
        }
        return resolved;
      });
    },
    [storageKey],
  );

  return [value, set];
}
