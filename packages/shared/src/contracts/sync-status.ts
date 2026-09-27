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
 *   - `last_synced_at`   — 2026-07-07 founder-requested extension: ISO
 *                          timestamp of the last completed sync run, so
 *                          the shell can render "synced Xm ago" and the
 *                          Sync-now button can confirm completion.
 *   - `message_progress` — 2026-09-26 founder-requested extension:
 *                          `{processed, total, age_ms}` while the scan
 *                          reads the mailbox, so the gate can show
 *                          "12,400 of 40,898 emails" and time left from
 *                          observed progress (reverses D109's "no live
 *                          counters").
 *
 * No body data, no headers, no message content of any kind — stage
 * enum + numeric progress + message counts + an allowlisted boolean. Safe by construction
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
 * Messages read so far of the messages in the mailbox — never more read
 * than exist — and how long ago the worker wrote them, measured by the
 * API. The age lets the gate time each count on its own clock, however
 * late its poll saw it.
 */
export const SyncMessageProgressSchema = z
  .object({
    processed: z.number().int().min(0),
    total: z.number().int().min(1),
    age_ms: z.number().int().min(0),
  })
  .strict()
  .refine((p) => p.processed <= p.total, { message: 'processed exceeds total' });
export type SyncMessageProgress = z.infer<typeof SyncMessageProgressSchema>;

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
    /**
     * ISO-8601 wall-clock of the last COMPLETED sync run (initial or
     * incremental), from `provider_sync_state.last_synced_at`. `null`
     * when no run has finished yet; optional so pre-field responses and
     * existing fixtures stay valid. Wall-clock only — carries no
     * message-derived data, so the §2.1 posture is unchanged.
     */
    last_synced_at: z.string().datetime().nullable().optional(),
    /**
     * Terminal INCREMENTAL failure marker
     * (`provider_sync_state.last_incremental_error_at/_code`). Set when
     * an incremental run dead-letters WITHOUT flipping
     * `readiness_status` (initial sync owns that); cleared by the next
     * successful run. The Sync-now completion watch ends early with an
     * error toast when this stamp moves — otherwise a failed run would
     * leave the user waiting on a completion that never comes.
     */
    last_sync_error_at: z.string().datetime().nullable().optional(),
    last_sync_error_code: z.string().min(1).nullable().optional(),
    /**
     * How far the scan has read: `processed` of the mailbox's `total`
     * messages, from the InitialSyncWorker's short-lived Redis key
     * (`scanProgressKey`, packages/workers/src/scan-progress.ts: written
     * per 500 messages read, cleared when an attempt starts and when the
     * read ends, expiring 30 min after its last write). Present only while
     * the scan reads the mailbox (`current_stage === 'fetching_metadata'`);
     * `null` before it has listed the mailbox — the total is unknown until
     * then — and in every other stage. Absent when the key could not be
     * read this time, so a client can tell "unknown" from "none"; also
     * optional so pre-field responses and existing fixtures stay valid.
     * Counts only — no message content.
     */
    message_progress: SyncMessageProgressSchema.nullable().optional(),
  })
  .strict();

export type SyncStatus = z.infer<typeof SyncStatusSchema>;
