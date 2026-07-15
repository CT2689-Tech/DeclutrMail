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
