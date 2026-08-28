/**
 * The Triage route's single TanStack Query key (D200).
 *
 * ONE key for the queue, the session stats and the D214 Today strip,
 * because those three are not independent reads — the strip's numbers are
 * computed FROM the queue rows. Fetching them separately meant the strip
 * could describe a different queue than the one rendered below it: a
 * different 90-day window (each request derived its own cutoff), a
 * different row set, or a stale subset entirely. Protecting a queued
 * sender rewrote its verdict to Keep and moved the strip's numbers, while
 * `use-sender-policy` invalidated only the queue — so the rows updated and
 * the strip did not.
 *
 * Patching the invalidators was tried and rejected: at least four paths
 * pull them apart (`invalidateAfterDecision`, `useRefreshStaleRead`,
 * `use-sender-policy`, and three independent `staleTime`s that refetch on
 * whichever component remounts first). One query is one instant and one
 * copy of the queue, and every invalidator covers it automatically because
 * there is only one key left to invalidate.
 *
 * The VALUE still reads `queue`, deliberately. Cross-feature invalidators
 * (`@/features/senders/api/use-sender-policy`) and onboarding's
 * `FIRST_TRIAGE_KEY` prefix already target this array; changing the string
 * would buy a tidier name at the cost of re-pointing every one of them.
 *
 * Split out of `use-triage-queue.ts` so a consumer that only needs the key
 * for invalidation does not drag in `apiGet` and the rest of that module.
 */
export const TRIAGE_BOOTSTRAP_KEY = ['triage', 'queue'] as const;
