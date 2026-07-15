/**
 * Centralised TanStack Query keys for the Snoozed surface (D200).
 *
 * Mirrors the convention from `features/followups/api/query-keys.ts`.
 * Keys are NOT partitioned by mailbox id (reads resolve the active
 * mailbox server-side) — `resetMailboxScopedCache` invalidates the
 * whole cache on every active-mailbox transition, which covers these.
 */
export const snoozedKeys = {
  all: ['snoozed'] as const,
  /** The Later-bucket list — the only Snoozed read endpoint at launch. */
  list: () => ['snoozed', 'list'] as const,
  /** Small all-tier summary for the persistent app-shell recovery alert. */
  recovery: () => ['snoozed', 'recovery'] as const,
};
