/**
 * Centralised TanStack Query keys for the Brief surface (D200).
 *
 * Same shape as `features/followups/api/query-keys.ts` and
 * `features/senders/api/query-keys.ts` — literal segments first, then a
 * stable serialisable params object so TanStack's `hashKey` produces
 * consistent hashes.
 *
 * Scope note (CLAUDE.md §8): these keys are NOT mailbox-partitioned by
 * key. Mailbox switches MUST trigger `resetMailboxScopedCache` (rather
 * than per-key invalidation) so stale-from-old-mailbox data does not
 * survive a switch. The Brief consumer relies on the shared reset
 * behaviour the rest of the FE already enforces on the mailbox change
 * event — no per-key opt-in needed here.
 */
export const briefKeys = {
  all: ['brief'] as const,
  /** Today's Brief (D69 frozen snapshot) for the current active mailbox. */
  today: () => ['brief', 'today'] as const,
};
