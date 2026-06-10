/**
 * Triage verb mutations (D226, D29/D227, D40).
 *
 * Keep is the only verb with a triage-specific endpoint: it is
 * policy/verdict-only (Action Registry `policy-only`), so it records
 * the decision via `POST /api/actions/keep-intent` — no Gmail
 * mutation, no worker job, no undo token. The destructive verbs ride
 * the shared pipeline hooks (`useEnqueueComposite`, `useActionStatus`,
 * `useRecordUnsubscribeIntent`) — the action pipeline is genuinely
 * shared infrastructure, so those hooks live in the feature-agnostic
 * `@/lib/api/use-action` rather than being duplicated per feature.
 *
 * Idempotency: keep-intent dedups semantically server-side (a Keep on
 * a sender already kept inside the decided window replays the original
 * row), so no `Idempotency-Key` header is sent.
 */

import { useMutation } from '@tanstack/react-query';

import { apiPost } from '@/lib/api/client';

/** Returned by `POST /api/actions/keep-intent`. */
export interface KeepIntentResult {
  senderId: string;
  /** ISO timestamp the verdict was recorded (or originally recorded, on replay). */
  recordedAt: string;
  /** activity_log.id of the keep decision row. */
  activityLogId: string;
}

export async function recordKeepIntent(senderId: string): Promise<KeepIntentResult> {
  const env = await apiPost<KeepIntentResult>('/api/actions/keep-intent', { senderId });
  return env.data;
}

/** Record a Keep verdict for one sender (D40 — applies immediately). */
export function useKeepIntent() {
  return useMutation<KeepIntentResult, Error, { senderId: string }>({
    mutationFn: ({ senderId }) => recordKeepIntent(senderId),
  });
}
