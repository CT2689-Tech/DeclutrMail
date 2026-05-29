/**
 * Centralised TanStack Query keys for the admin security-events
 * surface (D181 read).
 *
 * Mirrors the convention from `features/followups/api/query-keys.ts`:
 * each segment is either a literal string or a stable serialisable
 * params object so TanStack's `hashKey` produces consistent hashes.
 */
import type { ListSecurityEventsInput } from '@/lib/api/security-events';

export const securityEventsKeys = {
  all: ['security-events'] as const,
  /**
   * Filtered list — the filter object is the cache discriminator so
   * changing severity / event_type / time-range yields its own
   * cache entry (no cross-talk).
   */
  list: (filters: ListSecurityEventsInput) =>
    [
      'security-events',
      'list',
      {
        severity: filters.severity ?? null,
        eventType: filters.eventType ?? null,
        from: filters.from ?? null,
        to: filters.to ?? null,
        limit: filters.limit ?? null,
      },
    ] as const,
};
