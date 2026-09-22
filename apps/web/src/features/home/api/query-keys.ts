/**
 * Home reads Activity totals, so its keys belong to the Activity invalidation family.
 * Every committed decision, completed action, Undo and sync refreshes that family.
 *
 * NOT partitioned by mailbox id — the read resolves the active mailbox
 * server-side, so a switch relies on `resetMailboxScopedCache` (which
 * invalidates every query) like every other feature's keys.
 */
import { activityKeys } from '@/features/activity/api/query-keys';

export const homeKeys = {
  all: [...activityKeys.all, 'home'] as const,
  summary: () => [...activityKeys.all, 'home', 'summary'] as const,
};
