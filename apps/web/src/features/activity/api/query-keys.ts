/**
 * Centralised TanStack Query keys for the Activity surface (D200).
 *
 * Keys carry the full filter set so two different filter combinations
 * cache independently (a user toggling chips / verbs / dates back and
 * forth doesn't re-fetch the prior view from the network). Like the
 * other feature keys, these are NOT mailbox-partitioned — mailbox
 * switches rely on `resetMailboxScopedCache` to clear all scoped state
 * (CLAUDE.md §8 invariant).
 */

import type { ActivityFilters } from '@/lib/api/activity';

/**
 * Normalised filter shape used as the query key — sorts the multi-verb
 * array so two equivalent filter sets share a cache key regardless of
 * the order the user toggled them.
 */
export interface ActivityFilterKey {
  window: string;
  source: string;
  verbs: readonly string[];
  senderQuery: string;
  dateFrom: string | null;
  dateTo: string | null;
}

export function normalizeFilters(filters: ActivityFilters): ActivityFilterKey {
  return {
    window: filters.window ?? '30d',
    source: filters.source ?? 'all',
    verbs: [...(filters.verbs ?? [])].sort(),
    senderQuery: filters.senderQuery ?? '',
    dateFrom: filters.dateFrom ?? null,
    dateTo: filters.dateTo ?? null,
  };
}

export const activityKeys = {
  all: ['activity'] as const,
  list: (filters: ActivityFilters) => ['activity', 'list', normalizeFilters(filters)] as const,
};
