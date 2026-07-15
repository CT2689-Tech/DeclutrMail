'use client';

/**
 * URL-backed scope state for Senders.
 *
 * Search, temporary filters, and sorting describe one result set, so
 * they are written to the URL atomically. That makes links and refreshes
 * restore the same scope and prevents two quick changes from replacing
 * each other's query params. Cursor remains intentionally transient.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import type {
  ActivityBucket,
  SenderListDirection,
  SenderListSort,
  TriStateFilter,
} from '@/lib/api/senders';
import { EMPTY_COMPOSE, type ComposeState } from './compose-strip';
import { useSendersStore } from './store';

interface SenderScope {
  compose: ComposeState;
  query: string;
  sort: SenderListSort;
  direction: SenderListDirection;
}

export interface SavedSenderScope {
  compose: ComposeState;
  sort: Extract<SenderListSort, 'total' | 'last_seen' | 'first_seen' | 'name'>;
  direction: SenderListDirection;
}

/**
 * Safely consume the App Router hooks. Vitest renders without an
 * AppRouterContext; the local fallback keeps those renders useful while
 * production still receives a shareable URL.
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
  const aliases: Record<string, number> = {
    '30': 30,
    '90': 90,
    '180': 180,
    '365': 365,
    '30d': 30,
    '90d': 90,
    '180d': 180,
    '365d': 365,
  };
  if (aliases[raw] !== undefined) return aliases[raw]!;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 3650 ? parsed : null;
}

function parseSort(raw: string | null): SenderListSort {
  return raw === 'last_seen' ||
    raw === 'first_seen' ||
    raw === 'name' ||
    raw === 'read' ||
    raw === 'recommended'
    ? raw
    : 'total';
}

function parseDirection(raw: string | null): SenderListDirection {
  return raw === 'asc' ? 'asc' : 'desc';
}

function parseScope(params: URLSearchParams): SenderScope {
  const { activity, activityNegate } = parseActivity(params.get('activity'));
  return {
    compose: {
      activity,
      activityNegate,
      unsubReady: parseTri(params.get('unsub_ready')),
      replied: parseTri(params.get('replied')),
      protectedFlag: parseTri(params.get('protected')),
      windowDays: parseWindow(params.get('window')),
      domain: params.get('domain')?.trim() || null,
      unsubIgnored: params.get('unsub_ignored') === 'true',
    },
    query: params.get('q') ?? '',
    sort: parseSort(params.get('sort')),
    direction: parseDirection(params.get('direction')),
  } satisfies SenderScope;
}

function writeScope(params: URLSearchParams, scope: SenderScope): void {
  for (const key of [
    'activity',
    'unsub_ready',
    'replied',
    'protected',
    'window',
    'domain',
    'unsub_ignored',
    'q',
    'sort',
    'direction',
  ]) {
    params.delete(key);
  }

  const { compose } = scope;
  if (compose.activity) {
    params.set('activity', compose.activityNegate ? `not-${compose.activity}` : compose.activity);
  }
  if (compose.unsubReady === true) params.set('unsub_ready', 'true');
  else if (compose.unsubReady === false) params.set('unsub_ready', 'not');
  if (compose.replied === true) params.set('replied', 'true');
  else if (compose.replied === false) params.set('replied', 'not');
  if (compose.protectedFlag === true) params.set('protected', 'true');
  else if (compose.protectedFlag === false) params.set('protected', 'not');
  if (compose.windowDays !== null) params.set('window', String(compose.windowDays));
  if (compose.domain) params.set('domain', compose.domain);
  if (compose.unsubIgnored) params.set('unsub_ignored', 'true');

  const trimmedQuery = scope.query.trim();
  if (trimmedQuery) params.set('q', trimmedQuery);
  if (scope.sort !== 'total' || scope.direction !== 'desc') {
    params.set('sort', scope.sort);
    params.set('direction', scope.direction);
  }
}

function scopesEqual(a: SenderScope, b: SenderScope): boolean {
  return (
    a.query === b.query &&
    a.sort === b.sort &&
    a.direction === b.direction &&
    JSON.stringify(a.compose) === JSON.stringify(b.compose)
  );
}

export function useComposeState(): {
  compose: ComposeState;
  query: string;
  sort: SenderListSort;
  direction: SenderListDirection;
  setCompose: (next: ComposeState) => void;
  clearCompose: () => void;
  setQuery: (next: string) => void;
  setSort: (next: { sort: SenderListSort; direction: SenderListDirection }) => void;
  applySavedScope: (next: SavedSenderScope) => void;
  clearSearchAndFilters: () => void;
} {
  const appRouter = useOptionalAppRouter();
  const paramsSnapshot = appRouter?.params.toString() ?? null;
  const storeScope = useSendersStore.getState();
  const fallback: SenderScope = {
    compose: EMPTY_COMPOSE,
    query: '',
    sort: parseSort(storeScope.sort),
    direction: storeScope.direction,
  };
  const initial = appRouter ? parseScope(new URLSearchParams(paramsSnapshot ?? '')) : fallback;
  const [scope, setScope] = useState<SenderScope>(initial);
  const scopeRef = useRef(scope);
  const urlRef = useRef(new URLSearchParams(paramsSnapshot ?? ''));

  // A browser Back/Forward navigation is an external scope change. Pull
  // it into the controlled input and sort store without creating another
  // history entry.
  useEffect(() => {
    if (paramsSnapshot === null) return;
    const params = new URLSearchParams(paramsSnapshot);
    urlRef.current = params;
    const next = parseScope(params);
    scopeRef.current = next;
    setScope((current) => (scopesEqual(current, next) ? current : next));
    const store = useSendersStore.getState();
    if (store.sort !== next.sort || store.direction !== next.direction) {
      store.setSort({ sort: next.sort, direction: next.direction });
    }
  }, [paramsSnapshot]);

  const commit = useCallback(
    (next: SenderScope) => {
      scopeRef.current = next;
      setScope(next);
      const store = useSendersStore.getState();
      if (store.sort !== next.sort || store.direction !== next.direction) {
        store.setSort({ sort: next.sort, direction: next.direction });
      }
      if (!appRouter) return;
      const out = new URLSearchParams(urlRef.current.toString());
      writeScope(out, next);
      urlRef.current = out;
      const queryString = out.toString();
      appRouter.router.replace(`${appRouter.pathname}${queryString ? `?${queryString}` : ''}`, {
        scroll: false,
      });
    },
    [appRouter],
  );

  const setCompose = useCallback(
    (compose: ComposeState) => commit({ ...scopeRef.current, compose }),
    [commit],
  );
  const clearCompose = useCallback(() => setCompose(EMPTY_COMPOSE), [setCompose]);
  const setQuery = useCallback((query: string) => commit({ ...scopeRef.current, query }), [commit]);
  const setSort = useCallback(
    (next: { sort: SenderListSort; direction: SenderListDirection }) =>
      commit({
        ...scopeRef.current,
        sort: parseSort(next.sort),
        direction: next.direction,
      }),
    [commit],
  );
  const applySavedScope = useCallback(
    (next: SavedSenderScope) =>
      commit({
        compose: { ...next.compose },
        query: '',
        sort: next.sort,
        direction: next.direction,
      }),
    [commit],
  );
  const clearSearchAndFilters = useCallback(
    () => commit({ ...scopeRef.current, compose: EMPTY_COMPOSE, query: '' }),
    [commit],
  );

  return {
    ...scope,
    setCompose,
    clearCompose,
    setQuery,
    setSort,
    applySavedScope,
    clearSearchAndFilters,
  };
}
