/**
 * Snoozed API — typed fetchers for the Snoozed/Later review surface
 * (D78–D80).
 *
 * Wire shapes come straight from `@declutrmail/shared/contracts`
 * (`snoozed.ts`) — the same Zod-validated contract the BE controller
 * enforces, so FE/BE drift is a compile error.
 *
 * Privacy (D7, D228): rows carry sender display metadata, counts, and
 * timestamps. No subjects, snippets, or body-adjacent content.
 *
 * No client-side state lives here — pure functions the TanStack Query
 * hooks in `features/snoozed/api/` call from `queryFn` / `mutationFn`.
 */

import type {
  Envelope,
  LaterReturnRecoverySummary,
  SnoozedSenderRow,
  SnoozeUpdateRequest,
  SnoozeUpdateResult,
  WakeNowResult,
} from '@declutrmail/shared/contracts';

import { apiGet, apiPatch, apiPost } from './client';

export type { SnoozedSenderRow };

/** GET /api/snoozed/recovery — all-tier stuck-return safety summary. */
export function fetchLaterRecovery(
  signal?: AbortSignal,
): Promise<Envelope<LaterReturnRecoverySummary, unknown>> {
  return apiGet<LaterReturnRecoverySummary>('/api/snoozed/recovery', { signal });
}

/** GET /api/snoozed — the Later bucket for the current mailbox. */
export function fetchSnoozed(signal?: AbortSignal): Promise<Envelope<SnoozedSenderRow[], unknown>> {
  return apiGet<SnoozedSenderRow[]>('/api/snoozed', { signal });
}

/** PATCH /api/snoozed/:senderId — set or extend the required wake time. */
export async function patchSnooze(
  senderId: string,
  body: SnoozeUpdateRequest,
): Promise<SnoozeUpdateResult> {
  const env = await apiPatch<SnoozeUpdateResult>(
    `/api/snoozed/${encodeURIComponent(senderId)}`,
    body,
  );
  return env.data;
}

/** POST /api/snoozed/:senderId/wake — D80 "Wake now" (queued restore). */
export async function wakeNow(senderId: string): Promise<WakeNowResult> {
  const env = await apiPost<WakeNowResult>(`/api/snoozed/${encodeURIComponent(senderId)}/wake`, {});
  return env.data;
}

/** POST all-tier retry for a failed/missed return (healthy timers reject). */
export async function wakeRecoveryNow(senderId: string): Promise<WakeNowResult> {
  const env = await apiPost<WakeNowResult>(
    `/api/snoozed/recovery/${encodeURIComponent(senderId)}/wake`,
    {},
  );
  return env.data;
}
