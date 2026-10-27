/**
 * Home reads Activity totals, so its keys belong to the Activity invalidation family.
 * Every committed decision, completed action, Undo and sync refreshes that family.
 *
 * Displayed totals, reports and visit windows are partitioned by mailbox.
 * The unqualified summary key remains a prefix for existing invalidations.
 */
import { activityKeys } from '@/features/activity/api/query-keys';

export const homeKeys = {
  all: [...activityKeys.all, 'home'] as const,
  // Display-only identities must not join awaited action/Undo rebuild reads.
  senderPreview: (mailboxId: string | null, senderId: string) =>
    ['home-sender-preview', mailboxId, senderId] as const,
  // No id is the invalidation prefix; displayed totals always use a mailbox id.
  summary: (mailboxId?: string) =>
    [...activityKeys.all, 'home', 'summary', ...(mailboxId ? [mailboxId] : [])] as const,
  visit: (mailboxId: string | null) => [...activityKeys.all, 'home', 'visit', mailboxId] as const,
};
