/**
 * TanStack Query keys for the Home surface (D200).
 *
 * NOT partitioned by mailbox id — the read resolves the active mailbox
 * server-side, so a switch relies on `resetMailboxScopedCache` (which
 * invalidates every query) like every other feature's keys.
 */
export const homeKeys = {
  all: ['home'] as const,
  summary: () => ['home', 'summary'] as const,
};
