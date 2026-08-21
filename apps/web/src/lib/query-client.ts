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

import { retryTransientOnly } from './api/retry';
import { reportUpgradeGateHit } from './entitlements/upgrade-gate';

const DEFAULT_STALE_TIME_MS = 30_000;

export function makeQueryClient(): QueryClient {
  let client: QueryClient | null = null;
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
      // switched, revoked. A MUTATION had no recovery: its caller toasted
      // a generic failure and the user stayed on a screen full of a
      // mailbox that no longer resolves, with no way to the gate
      // (CLAUDE.md §8 "scope change ⇒ reset scoped cache").
      //
      // Global, like the 402 above, so every mutation surface recovers —
      // not only the handlers someone remembered to wire.
      if (client !== null && isMailboxScopeConflict(error)) {
        void resetMailboxScopedCache(client);
      }
    },
  });
  // The READ half of the same invariant (audit 2026-08-21).
  //
  // The mutation handler above used to justify its own existence by
  // saying reads were already covered — "the app shell renders the
  // reconnect gate off `me`". The gate does read `me`; nothing refetched
  // `me`. `refetchOnWindowFocus` is false below, `useMe` polls only
  // while a mailbox is syncing or deleting, and its doc comment claimed
  // a focus refetch it never configured. So after an out-of-band scope
  // change — disconnected in another tab, grant revoked by a worker —
  // `me` stayed cached, `hasActiveMailbox` stayed true, the gate never
  // rendered, and the always-mounted sync banner polled a dead mailbox
  // every 3s while rendering `null` on error. The storm was invisible in
  // the UI and the user sat on a broken screen until a manual reload.
  //
  // Mirror image of the mutation handler, for the same reason: a
  // recovery wired for one side and not the other is not wired.
  //
  // COALESCED, unlike the mutation side, because a read handler can feed
  // itself: the reset invalidates every query, they refetch, the ones
  // behind the guard 409 again, and each one re-enters this handler. The
  // cycle does terminate — `me` is behind JwtGuard only, so it resolves,
  // reports no active mailbox, and the shell swaps in the reconnect gate,
  // unmounting the scoped queries — but "it terminates eventually" is how
  // the original 409 storm was justified too. One reset per burst is all
  // the recovery needs, so the latch makes the bound structural instead
  // of emergent.
  let scopeResetAt = 0;
  const SCOPE_RESET_COALESCE_MS = 1_000;
  const queryCache = new QueryCache({
    onError: (error) => {
      if (client === null || !isMailboxScopeConflict(error)) return;
      const now = Date.now();
      if (now - scopeResetAt < SCOPE_RESET_COALESCE_MS) return;
      scopeResetAt = now;
      void resetMailboxScopedCache(client);
    },
  });
  client = new QueryClient({
    mutationCache,
    queryCache,
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
