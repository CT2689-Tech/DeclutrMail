/**
 * Quiet-hours API — typed fetchers for the per-mailbox quiet-hours
 * endpoints (U18 — D92, D95).
 *
 *   GET /api/mailboxes/:id/quiet-hours → { config, activeNow }
 *   PUT /api/mailboxes/:id/quiet-hours → same shape, after the save
 *
 * `config` is `null` until the mailbox has ever been configured.
 * `activeNow` comes from the SAME predicate the Autopilot action sweep
 * defers on, so the badge in the UI and the worker's behavior agree.
 *
 * Privacy (D7, D228): times + an IANA timezone name — no message data.
 */

import type { Envelope, QuietHoursConfig, QuietHoursState } from '@declutrmail/shared/contracts';
import { apiGet, apiPut } from './client';

/** GET /api/mailboxes/:id/quiet-hours */
export function fetchQuietHours(
  mailboxId: string,
  signal?: AbortSignal,
): Promise<Envelope<QuietHoursState, unknown>> {
  return apiGet<QuietHoursState>(`/api/mailboxes/${encodeURIComponent(mailboxId)}/quiet-hours`, {
    signal,
  });
}

/** PUT /api/mailboxes/:id/quiet-hours */
export function putQuietHours(
  mailboxId: string,
  config: QuietHoursConfig,
): Promise<Envelope<QuietHoursState, unknown>> {
  return apiPut<QuietHoursState>(
    `/api/mailboxes/${encodeURIComponent(mailboxId)}/quiet-hours`,
    config,
  );
}
