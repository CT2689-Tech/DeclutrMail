import { z } from 'zod';

import type { TriageVerdict } from '@declutrmail/db';
import type { ActionJobStatus, CanonicalVerb } from '@declutrmail/shared/contracts';

/**
 * Screener API contracts (D71–D77).
 *
 * The Screener queue is the soft-quarantine review surface for
 * first-time senders (D72 — DB rows only, Gmail untouched until the
 * user decides). "Screener" is the feature name (D227-allowed); no
 * user-facing copy here carries the verb "Screen" — decisions are the
 * canonical K/A/U/L/D verbs.
 */

/**
 * The five verbs a Screener decision can carry — exactly the canonical
 * K/A/U/L/D set (D227 + ADR-0019). Declared as a literal tuple for
 * `z.enum`; the `satisfies` + the two-way assertions below pin it to
 * `CanonicalVerb` so a registry verb change is a compile error here.
 */
export const SCREENER_DECIDE_VERBS = [
  'keep',
  'archive',
  'unsubscribe',
  'later',
  'delete',
] as const satisfies readonly CanonicalVerb[];
export type ScreenerDecideVerb = (typeof SCREENER_DECIDE_VERBS)[number];

// Two-way compile-time guard: the decide-verb union IS CanonicalVerb.
const _DECIDE_EXTENDS_CANONICAL: ScreenerDecideVerb extends CanonicalVerb ? true : false = true;
const _CANONICAL_EXTENDS_DECIDE: CanonicalVerb extends ScreenerDecideVerb ? true : false = true;
void _DECIDE_EXTENDS_CANONICAL;
void _CANONICAL_EXTENDS_DECIDE;

/**
 * Decide request — `POST /api/screener/decide`.
 *
 * `senderId` is the `senders.id` UUID the queue row carries (the same
 * selector the action pipeline takes — the sha256 sender_key is never
 * asked of the client). `olderThanDays` is the optional time-window
 * for the label-modify verbs, mirroring the composite action schema's
 * range (matches the `action_jobs.older_than_days` DB CHECK).
 */
export const screenerDecideRequestSchema = z
  .object({
    senderId: z.string().uuid(),
    verb: z.enum(SCREENER_DECIDE_VERBS),
    olderThanDays: z.number().int().min(1).max(3650).nullable().optional(),
  })
  .strict();
export type ScreenerDecideRequest = z.infer<typeof screenerDecideRequestSchema>;

/**
 * One row in the Screener queue (D71 row content, D73 expanded body).
 *
 * Sender identity + first-seen + counts come from joins on `senders` /
 * `mail_messages`; the engine recommendation from `triage_decisions`.
 * D7-allowlisted surface only: sender, subject, dates, aggregates — no
 * body, no attachment, no extra headers.
 */
export interface ScreenerQueueRow {
  /** `screener_quarantine.id` — the queue row identity. */
  id: string;
  /** `senders.id` — the action-pipeline selector (D226 wiring). */
  senderId: string;
  senderKey: string;
  senderName: string;
  senderEmail: string;
  senderDomain: string;
  /** ISO timestamp the sender was first seen (D71 "8 min ago"). */
  firstSeenAt: string;
  /** ISO timestamp the row entered the Screener queue. */
  queuedAt: string;
  /** Messages received from this sender so far (D73 expanded body). */
  messageCount: number;
  /** Latest message's subject — the D71 sample subject. Empty when none. */
  sampleSubject: string;
  /** Sender-level unsubscribe channel (drives the U affordance copy). */
  unsubscribeMethod: 'one_click' | 'mailto' | 'none';
  /**
   * Engine recommendation (D71 — verdict + confidence pip + reasoning).
   * `null` when the engine hasn't scored the sender yet (decision row
   * absent) — the FE renders the row without a recommendation pip.
   */
  recommendation: {
    verdict: TriageVerdict;
    confidence: number;
    reasoning: string;
  } | null;
}

/** Badge payload — `GET /api/screener/count` (D74). */
export interface ScreenerCountResult {
  /** Senders awaiting a decision in the active mailbox. */
  pending: number;
}

/**
 * Decide response — `POST /api/screener/decide`.
 *
 * `execution` is discriminated by how the verb runs (mirrors the
 * Action Registry's execution kinds):
 *
 *   - `policy`      — Keep: recorded immediately, nothing in Gmail
 *                     changes, no undo token (D40).
 *   - `unsubscribe` — the intent endpoint's result: one_click enqueues
 *                     a real execution to poll; mailto returns the
 *                     manual-compose URL (D230); none falls through.
 *   - `enqueued`    — Archive / Later / Delete: an `action_jobs`
 *                     handle to poll at `GET /api/actions/:id` until
 *                     the worker confirms (then the undo token lands).
 */
export interface ScreenerDecideResult {
  senderId: string;
  verb: ScreenerDecideVerb;
  /**
   * Whether THIS call resolved the pending quarantine row. `false`
   * means the row was already resolved (or never existed) — the
   * idempotent-replay case; the decision itself still stands via the
   * delegated pipeline's own idempotency.
   */
  resolved: boolean;
  execution:
    | { kind: 'policy'; activityLogId: string }
    | {
        kind: 'unsubscribe';
        method: 'one_click' | 'mailto' | 'none';
        executionActionId: string | null;
        mailtoUrl: string | null;
        activityLogId: string;
      }
    | { kind: 'enqueued'; actionId: string; status: ActionJobStatus; requestedCount: number };
}
