/**
 * Centralised TanStack Query keys for the Senders surface (D200).
 *
 * Why a key module? So invalidations after mutations (Archive,
 * Unsubscribe, Later, Protect toggle, etc.) can target the right cache
 * entries without stringly-typed keys scattered across hooks. Each
 * factory returns an array literal that's both readable as a hierarchy
 * (e.g. `senders → detail → id → messages`) and stable across
 * re-renders (so TanStack's structural equality matches).
 *
 * Convention: each segment is either a literal string OR an object of
 * stable serialisable params. Params objects must contain only
 * primitives — never functions or class instances — so TanStack's
 * `hashKey` produces consistent hashes.
 */

import type {
  ActivityBucket,
  GmailCategory,
  SenderListDirection,
  SenderListSort,
  TriStateFilter,
} from '@/lib/api/senders';

export const sendersKeys = {
  all: ['senders'] as const,
  /**
   * List page — keyed by every parameter that changes what the BE
   * returns, so distinct queries cache independently.
   *
   * Why `limit` AND `isProtected` are in the key: the Settings → Standing
   * Policies surface previously called `useSenders({ limit: 100 })`
   * while the shell + main screen called `useSenders({ limit: 50 })` —
   * both keyed by category only, so they collided in the same cache
   * entry with mixed page sizes. Slice 0 of the senders redesign fixes
   * this by promoting `limit` and the new `isProtected` filter into the
   * key. Mailbox scope is still handled by `resetMailboxScopedCache` on
   * mailbox switch (§8 invariant) — promoting mailbox into the key
   * itself is a later cleanup.
   */
  list: (
    params: {
      category?: GmailCategory | undefined;
      limit?: number | undefined;
      isProtected?: TriStateFilter | undefined;
      sort?: SenderListSort | undefined;
      direction?: SenderListDirection | undefined;
      /** Search term (#145) — in the key so each query caches separately
       *  and a new search resets to page 1 (cursor is search-scoped). */
      q?: string | undefined;
      /** D38 compose strip — each axis is in the key so distinct
       *  composes cache independently and a new compose resets to
       *  page 1 (cursor is compose-scoped). */
      activity?: ActivityBucket | undefined;
      activityNegate?: boolean | undefined;
      unsubReady?: TriStateFilter | undefined;
      replied?: TriStateFilter | undefined;
      windowDays?: number | undefined;
      domain?: string | undefined;
      /** D51 — "unsub'd, still emailing" axis. */
      unsubIgnored?: boolean | undefined;
    } = {},
  ) => ['senders', 'list', params] as const,
  /** Weekly Hero slices (D47, D48) — singleton per mailbox. */
  weeklyHero: () => ['senders', 'weekly-hero'] as const,
  /**
   * Mailbox-wide aggregates (#145, real-data counts mandate) — drives
   * the hero, KPI strip, and intent chips on the Senders screen. Keyed
   * by `q` so each active search caches separately and `invalidateQueries()`
   * (no filter, the canonical mailbox-switch reset) refetches whichever
   * `q` is mounted. Mailbox scope rides `resetMailboxScopedCache` like
   * the rest of the senders surface — see §8 invariant comment on `list`.
   */
  summary: (params: { q?: string | undefined } = {}) => ['senders', 'summary', params] as const,
  /** Single sender — the umbrella the per-id child queries hang off. */
  detail: (id: string) => ['senders', 'detail', id] as const,
  /** Recent-messages for one sender. */
  messages: (id: string) => ['senders', 'detail', id, 'messages'] as const,
  /** 12-month timeseries for one sender. */
  timeseries: (id: string) => ['senders', 'detail', id, 'timeseries'] as const,
  /** Decision history for one sender. */
  history: (id: string) => ['senders', 'detail', id, 'history'] as const,
};
