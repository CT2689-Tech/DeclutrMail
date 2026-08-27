/**
 * The triage queue's TanStack Query key, split out of `use-triage-queue.ts`
 * (D200).
 *
 * A consumer that only needs this key for cache invalidation — e.g. the
 * sender-policy mutation (`@/features/senders/api/use-sender-policy`) —
 * used to import it from the hook file, which drags in `apiGet` and the
 * rest of that module's body just to invalidate one key. Same shape as
 * `@/features/activity/api/query-keys` and
 * `@/features/senders/api/query-keys`.
 */
export const TRIAGE_QUEUE_KEY = ['triage', 'queue'] as const;
