/**
 * Centralised TanStack Query keys for the Activity surface (D200).
 *
 * Keys carry the window + source params so two different filter
 * combinations cache independently (a user toggling chips back and
 * forth doesn't re-fetch the prior view from the network). Like the
 * other feature keys, these are NOT mailbox-partitioned — mailbox
 * switches rely on `resetMailboxScopedCache` to clear all scoped state
 * (CLAUDE.md §8 invariant).
 */

import type { ActivitySourceFilterWire, ActivityWindowWire } from '@/lib/api/activity';

export const activityKeys = {
  all: ['activity'] as const,
  list: (window: ActivityWindowWire, source: ActivitySourceFilterWire) =>
    ['activity', 'list', { window, source }] as const,
};
