// TanStack Query client factory (D200).
//
// One `QueryClient` per Next.js *request* on the server and one per
// *browser session* on the client. Returning a fresh client per server
// render avoids cross-request cache bleed; the providers module
// memoizes a singleton for the browser. Defaults are sized for
// DeclutrMail: most queries are read-mostly product data where a short
// staleTime saves redundant fetches without making the UI feel stale,
// and we never want a tab-focus to silently trigger a refetch storm.

import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';

import {
  isMailboxScopeConflict,
  resetMailboxScopedCache,
} from '@/features/mailboxes/api/reset-mailbox-cache';

import { ApiError } from './api/client';
import { retryTransientOnly } from './api/retry';
import { reportUpgradeGateHit } from './entitlements/upgrade-gate';
import { captureFeatureException } from './sentry';

const DEFAULT_STALE_TIME_MS = 30_000;

/**
 * The query key's first segment — `['auth','me']` → `auth`. Only the first
 * segment, because later ones carry ids and filter text that must never
 * reach a third party (D7/D228); the first names the surface, which is all
 * a triage tag needs.
 */
function queryScope(queryKey: readonly unknown[]): string {
  const head = queryKey[0];
  return typeof head === 'string' ? head : 'unknown';
}

/**
 * At most one report per surface per window. A failing read is usually a
 * RETRYING read — `useMe` alone re-attempts every 15s while the app has no
 * session — and an un-throttled reporter would turn one broken surface into
 * thousands of events. Throttling by scope (not by full key) keeps the
 * bookkeeping bounded to the ~dozen surfaces that exist, so this can never
 * grow into a leak the way a per-key map would.
 */
const QUERY_FAILURE_REPORT_WINDOW_MS = 60_000;

/**
 * Report a failed read to Sentry unless it is a state the app is designed
 * to render.
 *
 * A 4xx here is a designed state, not a defect: 401 routes to the OAuth
 * redirect, 402 to the upgrade gate, 409 to the mailbox picker / reconnect
 * gate, 404 to an empty surface (CLAUDE.md §8, "a read guard's 4xx is a
 * designed state"). Anything else — a 5xx, a network drop, or an error
 * that isn't an `ApiError` at all — is a real failure the founder should
 * not have to find by hand.
 *
 * The non-`ApiError` half is the one that earned this handler. On
 * 2026-08-21 a `useUserTimeZone()` observer left `skipToken` on the shared
 * `me` query, so the `invalidateQueries` that every action mutation fires
 * rejected with `Missing queryFn: '["auth","me"]'`, AuthProvider fell to
 * "Auth check failed.", and the whole app died. Sentry recorded ZERO
 * events, because until now only mutations had a cache-level handler and
 * a rejected QUERY promise reached nothing at all.
 */
function makeQueryFailureReporter(): (error: unknown, queryKey: readonly unknown[]) => void {
  const lastReportedAt = new Map<string, number>();
  return (error, queryKey) => {
    if (error instanceof ApiError && error.status >= 400 && error.status < 500) return;
    const scope = queryScope(queryKey);
    const now = Date.now();
    const previous = lastReportedAt.get(scope);
    if (previous !== undefined && now - previous < QUERY_FAILURE_REPORT_WINDOW_MS) return;
    lastReportedAt.set(scope, now);
    captureFeatureException(error, { surface: 'query', reason: scope });
  };
}

export function makeQueryClient(): QueryClient {
  let client: QueryClient | null = null;
  const reportQueryFailure = makeQueryFailureReporter();
  const queryCache = new QueryCache({
    onError: (error, query) => reportQueryFailure(error, query.queryKey),
  });
  const mutationCache = new MutationCache({
    // Entitlement 402s (FREE_CAP_REACHED / INBOX_LIMIT_REACHED /
    // ACTION_TIER_REQUIRED, D19/
    // D77/D81) are designed states, not failures — ONE global handler
    // routes them to the upgrade-gate store so every mutation surface
    // gets the UpgradeModal without per-hook wiring. Other errors pass
    // through to the caller's own onError untouched.
    onError: (error) => {
      reportUpgradeGateHit(error);
      // A mutation that fails the mailbox guard proves the client's idea
      // of the active mailbox is wrong — disconnected in another tab,
      // switched, revoked. Reads already treat that 4xx as a designed
      // state and the app shell renders the reconnect gate off `me`, but
      // a MUTATION had no such recovery: its caller toasted a generic
      // failure and the user stayed on a screen full of a mailbox that
      // no longer resolves, with no way to the gate (CLAUDE.md §8
      // "scope change ⇒ reset scoped cache").
      //
      // Global, like the 402 above, so every mutation surface recovers —
      // not only the handlers someone remembered to wire.
      if (client !== null && isMailboxScopeConflict(error)) {
        void resetMailboxScopedCache(client);
      }
    },
  });
  client = new QueryClient({
    queryCache,
    mutationCache,
    defaultOptions: {
      queries: {
        staleTime: DEFAULT_STALE_TIME_MS,
        refetchOnWindowFocus: false,
        // Don't retry client errors (4xx) — a 409 means the active
        // mailbox can't be resolved, which retrying only amplifies (the
        // 409 storm, logs 2026-05-27). Transient 5xx/network still back
        // off 3×. Tests override this with `retry: false`.
        retry: retryTransientOnly,
      },
    },
  });
  return client;
}
