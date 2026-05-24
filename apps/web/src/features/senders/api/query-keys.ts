/**
 * Centralised TanStack Query keys for the Senders surface (D200).
 *
 * Why a key module? So invalidations after mutations (Archive,
 * Unsubscribe, Later, VIP toggle, etc.) can target the right cache
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

import type { GmailCategory } from '@/lib/api/senders';

export const sendersKeys = {
  all: ['senders'] as const,
  /** List page — keyed by category filter so each filter caches independently. */
  list: (params: { category?: GmailCategory | undefined } = {}) =>
    ['senders', 'list', params] as const,
  /** Single sender — the umbrella the per-id child queries hang off. */
  detail: (id: string) => ['senders', 'detail', id] as const,
  /** Recent-messages for one sender. */
  messages: (id: string) => ['senders', 'detail', id, 'messages'] as const,
  /** 12-month timeseries for one sender. */
  timeseries: (id: string) => ['senders', 'detail', id, 'timeseries'] as const,
  /** Decision history for one sender. */
  history: (id: string) => ['senders', 'detail', id, 'history'] as const,
};
