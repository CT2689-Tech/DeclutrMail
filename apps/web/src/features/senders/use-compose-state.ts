'use client';

/**
 * `useComposeState` — URL-backed state for the D38 compose strip.
 *
 * Each axis lives in a search param so the active scope is shareable
 * (paste a URL, get the same view) + refresh-stable. Wire encoding
 * mirrors the BE filter-param parsers:
 *
 *   ?activity=active | not-quiet | dormant | …
 *   ?unsub_ready=true | not
 *   ?replied=true | not
 *   ?protected=true | not
 *   ?window=30 | 90 | 180 | 365
 *   ?domain=<substring>
 *
 * Sort / search live on their own keys (`sort`, `direction`, `q`).
 * Cursor is intentionally NOT carried in URL state — it's a transient
 * intra-scroll position, not a scope identity.
 */

import { useCallback, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import type { ActivityBucket, TriStateFilter } from '@/lib/api/senders';
import { EMPTY_COMPOSE, type ComposeState } from './compose-strip';

/**
 * Safely consume the App Router hooks. Test environments without an
 * AppRouterContext (Vitest + RTL renders that don't wrap a router)
 * throw `invariant expected app router to be mounted`; falling back
 * to local in-memory state keeps the screen testable without per-test
 * router mocks while production still gets URL-shareable scopes.
 */
function useOptionalAppRouter() {
  try {
    return {
      router: useRouter(),
      pathname: usePathname(),
      params: useSearchParams(),
    };
  } catch {
    return null;
  }
}

function parseActivity(raw: string | null): {
  activity: ActivityBucket | null;
  activityNegate: boolean;
} {
  if (!raw) return { activity: null, activityNegate: false };
  const negate = raw.startsWith('not-');
  const value = negate ? raw.slice(4) : raw;
  if (value === 'active' || value === 'quiet' || value === 'dormant') {
    return { activity: value, activityNegate: negate };
  }
  return { activity: null, activityNegate: false };
}

function parseTri(raw: string | null): TriStateFilter {
  if (raw === 'true') return true;
  if (raw === 'not' || raw === 'false') return false;
  return null;
}

function parseWindow(raw: string | null): number | null {
  if (!raw) return null;
  const map: Record<string, number> = {
    '30': 30,
    '90': 90,
    '180': 180,
    '365': 365,
    '30d': 30,
    '90d': 90,
    '180d': 180,
    '365d': 365,
  };
  if (map[raw] !== undefined) return map[raw]!;
  const n = Number.parseInt(raw, 10);
  if (Number.isFinite(n) && n >= 1 && n <= 3650) return n;
  return null;
}

/**
 * Read the compose state from the current URL. Pure derivation — every
 * axis falls back to the empty default when its param is missing or
 * malformed, so a bad URL never throws.
 */
export function useComposeState(): {
  compose: ComposeState;
  setCompose: (next: ComposeState) => void;
  clearCompose: () => void;
} {
  const appRouter = useOptionalAppRouter();
  // Local state fallback for environments without an App Router
  // (Vitest + RTL renders). Production always has appRouter !== null.
  const [localState, setLocalState] = useState<ComposeState>(EMPTY_COMPOSE);

  const compose = useMemo<ComposeState>(() => {
    if (!appRouter) return localState;
    const { params } = appRouter;
    const { activity, activityNegate } = parseActivity(params.get('activity'));
    return {
      activity,
      activityNegate,
      unsubReady: parseTri(params.get('unsub_ready')),
      replied: parseTri(params.get('replied')),
      protectedFlag: parseTri(params.get('protected')),
      windowDays: parseWindow(params.get('window')),
      domain: params.get('domain')?.trim() || null,
    };
  }, [appRouter, localState]);

  const writeUrl = useCallback(
    (next: ComposeState) => {
      if (!appRouter) {
        setLocalState(next);
        return;
      }
      const { router, pathname, params } = appRouter;
      const out = new URLSearchParams(params.toString());
      // Keep non-compose params (sort, direction, q) intact.
      out.delete('activity');
      out.delete('unsub_ready');
      out.delete('replied');
      out.delete('protected');
      out.delete('window');
      out.delete('domain');
      if (next.activity) {
        out.set('activity', next.activityNegate ? `not-${next.activity}` : next.activity);
      }
      if (next.unsubReady === true) out.set('unsub_ready', 'true');
      else if (next.unsubReady === false) out.set('unsub_ready', 'not');
      if (next.replied === true) out.set('replied', 'true');
      else if (next.replied === false) out.set('replied', 'not');
      if (next.protectedFlag === true) out.set('protected', 'true');
      else if (next.protectedFlag === false) out.set('protected', 'not');
      if (next.windowDays !== null) out.set('window', String(next.windowDays));
      if (next.domain) out.set('domain', next.domain);
      const qs = out.toString();
      // `router.replace` keeps the nav stack tidy (compose changes are
      // not "back-able" moments — Esc / clear is the cleaner affordance).
      router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false });
    },
    [appRouter],
  );

  const setCompose = useCallback(
    (next: ComposeState) => {
      writeUrl(next);
    },
    [writeUrl],
  );

  const clearCompose = useCallback(() => {
    writeUrl(EMPTY_COMPOSE);
  }, [writeUrl]);

  return { compose, setCompose, clearCompose };
}
