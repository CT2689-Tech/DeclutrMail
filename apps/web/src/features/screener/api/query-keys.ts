/**
 * The screener queue's TanStack Query key, split out of `use-screener.ts`
 * (D200).
 *
 * A consumer that only needs this key for cache invalidation — e.g. the
 * sender-policy mutation (`@/features/senders/api/use-sender-policy`) —
 * used to import it from the hook file, which drags in `apiGet`/
 * `apiPost` and the rest of that module's body just to invalidate one
 * key. Same shape as `@/features/activity/api/query-keys` and
 * `@/features/senders/api/query-keys`.
 */
export const SCREENER_QUEUE_KEY = ['screener', 'queue'] as const;

/**
 * Shared parent prefix. TanStack matches by prefix, so invalidating this
 * reaches BOTH the queue and the count — which anything that can change
 * membership (a re-score that graduates a sender) must do, or the badge
 * and the list disagree until the count's next poll.
 */
export const SCREENER_ALL_KEY = ['screener'] as const;
