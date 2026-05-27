/**
 * Centralised TanStack Query keys for the Followups surface (D200).
 *
 * Mirrors the convention from `features/senders/api/query-keys.ts`:
 * each segment is either a literal string or a stable serialisable
 * params object so TanStack's `hashKey` produces consistent hashes.
 */
export const followupsKeys = {
  all: ['followups'] as const,
  /** Awaiting list — the only Followups read endpoint at launch. */
  list: () => ['followups', 'list'] as const,
};
