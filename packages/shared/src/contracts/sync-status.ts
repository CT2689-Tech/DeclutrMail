/**
 * SyncStatus — transport schema for the sync gate (D224).
 *
 * The onboarding sync gate (D6, D109) reads this contract via the
 * `useSyncStatus()` hook polling `GET /api/v1/sync/status` every 3s
 * (D200). There is no push transport — `sync.started` / `sync.progress`
 * / `sync.completed` / `sync.failed` / `sync.degraded` are server-side
 * PostHog/Sentry events (D159) only, never UI transport.
 *
 * Field set is locked by D224 and intentionally minimal:
 *   - `readiness_status` — coarse state the strict gate reads
 *   - `current_stage`    — fine-grained stage the D109 indicator animates
 *   - `progress_pct`     — 0-100 progress bar
 *   - `error_code`       — present only when `readiness_status === 'failed'`
 *   - `is_ready_for_triage` — derived convenience boolean
 *                            (`readiness_status === 'ready'`)
 *
 * No body data, no headers, no message content of any kind — stage
 * enum + numeric progress + an allowlisted boolean. Safe by construction
 * for the §2.1 privacy guardrail.
 */

import { z } from 'zod';

/** Coarse readiness state — drives the strict sync gate (D6). */
export const SyncReadinessSchema = z.enum(['queued', 'syncing', 'ready', 'failed']);
export type SyncReadiness = z.infer<typeof SyncReadinessSchema>;

/** Fine-grained stage — drives the D109 stage indicator animation. */
export const SyncStageSchema = z.enum([
  'queued',
  'fetching_metadata',
  'building_sender_index',
  'computing_recommendations',
  'finalizing',
  'ready',
  'failed',
]);
export type SyncStage = z.infer<typeof SyncStageSchema>;

/**
 * The full sync-status payload.
 *
 * `progress_pct` is a smallint 0-100 in the DB (D224); the schema
 * mirrors that with an int constraint so out-of-range values from a
 * misbehaving worker fail validation at the controller boundary instead
 * of leaking to the UI.
 *
 * `error_code` is omitted entirely when no error is present (consistent
 * with `exactOptionalPropertyTypes`).
 */
export const SyncStatusSchema = z
  .object({
    readiness_status: SyncReadinessSchema,
    current_stage: SyncStageSchema,
    progress_pct: z.number().int().min(0).max(100),
    is_ready_for_triage: z.boolean(),
    error_code: z.string().min(1).optional(),
  })
  .strict();

export type SyncStatus = z.infer<typeof SyncStatusSchema>;
