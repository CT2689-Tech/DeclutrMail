// TanStack Query client factory (D200).
//
// One `QueryClient` per Next.js *request* on the server and one per
// *browser session* on the client. Returning a fresh client per server
// render avoids cross-request cache bleed; the providers module
// memoizes a singleton for the browser. Defaults are sized for
// DeclutrMail: most queries are read-mostly product data where a short
// staleTime saves redundant fetches without making the UI feel stale,
// and we never want a tab-focus to silently trigger a refetch storm.

import { MutationCache, QueryClient } from '@tanstack/react-query';

import { retryTransientOnly } from './api/retry';
import { reportUpgradeGateHit } from './entitlements/upgrade-gate';

const DEFAULT_STALE_TIME_MS = 30_000;

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    // Entitlement 402s (FREE_CAP_REACHED / INBOX_LIMIT_REACHED, D19/
    // D77/D81) are designed states, not failures — ONE global handler
    // routes them to the upgrade-gate store so every mutation surface
    // gets the UpgradeModal without per-hook wiring. Other errors pass
    // through to the caller's own onError untouched.
    mutationCache: new MutationCache({
      onError: (error) => {
        reportUpgradeGateHit(error);
      },
    }),
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
}
