import { z } from 'zod';

/**
 * Truthful unsubscribe lifecycle shared by API, workers, and clients.
 *
 * A 2xx RFC 8058 response proves only that the remote endpoint accepted
 * the request; it does not prove that future mail has stopped. Likewise,
 * opening a mailto draft is not the same as sending it. The status names
 * deliberately preserve those boundaries.
 */
export const UNSUBSCRIBE_LIFECYCLE_STATUSES = [
  'requested',
  'endpoint_accepted',
  'failed',
  'unconfirmed',
  'action_required',
  'draft_opened',
  'user_marked_sent',
  'unavailable',
] as const;

export const UnsubscribeLifecycleStatusSchema = z.enum(UNSUBSCRIBE_LIFECYCLE_STATUSES);
export type UnsubscribeLifecycleStatus = z.infer<typeof UnsubscribeLifecycleStatusSchema>;

/** Values persisted before the truthful lifecycle migration. */
export type LegacyUnsubscribeLifecycleStatus = 'pending' | 'done' | 'ambiguous';

/**
 * Normalize old rows at read boundaries while deployments roll forward.
 * New writes use only the canonical lifecycle values above.
 */
export function normalizeUnsubscribeLifecycleStatus(
  status: UnsubscribeLifecycleStatus | LegacyUnsubscribeLifecycleStatus | null | undefined,
): UnsubscribeLifecycleStatus | null {
  switch (status) {
    case 'pending':
      return 'requested';
    case 'done':
      return 'endpoint_accepted';
    case 'ambiguous':
      return 'unconfirmed';
    case undefined:
    case null:
      return null;
    default:
      return status;
  }
}

/** Initial durable state created for each discovered unsubscribe method. */
export function initialUnsubscribeLifecycleStatus(
  method: 'one_click' | 'mailto' | 'none',
): UnsubscribeLifecycleStatus {
  switch (method) {
    case 'one_click':
      return 'requested';
    case 'mailto':
      return 'action_required';
    case 'none':
      return 'unavailable';
  }
}

/**
 * `action_jobs.error_code` that marks a one-click request as SENT with
 * an outcome we could not establish (a 3xx from the endpoint).
 *
 * Shared because three places must agree on the exact string: the worker
 * that writes it, the batch aggregation that classifies it, and the FE
 * that renders it. Triplicated literals meant a rename in the worker
 * would silently reclassify every `unconfirmed` row as `failed` with
 * nothing failing to compile — and `unconfirmed` is precisely the
 * outcome D248 refuses to round toward a neighbour.
 */
export const UNSUB_AMBIGUOUS_REDIRECT_ERROR_CODE = 'UNSUB_AMBIGUOUS_REDIRECT';

/**
 * `action_jobs.error_code` that marks a one-click request the endpoint
 * REFUSED, for a sender that also advertises a `mailto:` channel — so
 * the automated path is spent but a manual one remains (D252).
 *
 * `action_job_status` has no "needs the user" value, so this rides on
 * `failed` exactly the way `unconfirmed` does, and the error code is
 * what separates them. Without it a rejection with a live fallback is
 * indistinguishable from a genuine dead end, which is the difference
 * between "we can't" and "you can" — the whole point of the cascade.
 */
export const UNSUB_MANUAL_REQUIRED_ERROR_CODE = 'UNSUB_MANUAL_REQUIRED';

/** Manual mailto transitions the client may explicitly report. */
export const UNSUBSCRIBE_MANUAL_TRANSITIONS = ['draft_opened', 'user_marked_sent'] as const;
export const UnsubscribeManualTransitionSchema = z.enum(UNSUBSCRIBE_MANUAL_TRANSITIONS);
export type UnsubscribeManualTransition = z.infer<typeof UnsubscribeManualTransitionSchema>;

export const UnsubscribeManualStatusRequestSchema = z
  .object({
    senderId: z.string().uuid(),
    status: UnsubscribeManualTransitionSchema,
  })
  .strict();
export type UnsubscribeManualStatusRequest = z.infer<typeof UnsubscribeManualStatusRequestSchema>;
