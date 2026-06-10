import { z } from 'zod';

/**
 * Action API contracts (D226).
 *
 * The EXTERNAL selector the FE sends. `sender` carries the `senderId`
 * (the `senders.id` uuid the Sender Detail screen already has) — the
 * service resolves it to the sha256 `sender_key` server-side, which also
 * enforces ownership. The sha256 key is never asked of the client.
 *
 * `messages` is capped so a single request can't carry an unbounded id
 * list (the bulk path is the sender selector, which the worker resolves
 * itself). Privacy (D7): the selector carries ids only.
 */

/** Max ids accepted in one `messages` selector. Bulk → use the sender selector. */
export const MESSAGES_SELECTOR_MAX = 500;

export const archiveSelectorSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('sender'), senderId: z.string().uuid() }).strict(),
  z
    .object({
      type: z.literal('messages'),
      messageIds: z.array(z.string().min(1)).min(1).max(MESSAGES_SELECTOR_MAX),
    })
    .strict(),
]);
export type ArchiveSelector = z.infer<typeof archiveSelectorSchema>;

export const archiveRequestSchema = z
  .object({
    selector: archiveSelectorSchema,
    /** Required to act on a Protected / VIP sender (defense-in-depth, D42). */
    override: z.boolean().optional(),
  })
  .strict();
export type ArchiveRequest = z.infer<typeof archiveRequestSchema>;

/**
 * Unsubscribe-intent request shape — `POST /api/actions/unsubscribe-intent`.
 *
 * Records the user's DECISION to unsubscribe from a sender without
 * triggering a Gmail mutation. Wired before the real unsub pipeline
 * (RFC8058 + mailto + manual fallback per D230) lands so the founder
 * can ship Unsub-button-as-honest-affordance instead of the prior
 * tracer toast (CLAUDE.md §10 no-fake-completion violation 2026-06-05).
 */
export const unsubscribeIntentRequestSchema = z
  .object({
    senderId: z.string().uuid(),
  })
  .strict();
export type UnsubscribeIntentRequest = z.infer<typeof unsubscribeIntentRequestSchema>;

/**
 * Unsubscribe-intent response — `POST /api/actions/unsubscribe-intent`.
 *
 * Carries the activity_log row id so the FE can deep-link "see in
 * Activity" if the toast surface offers that link.
 */
export interface UnsubscribeIntentResult {
  senderId: string;
  /** ISO timestamp the intent was recorded. */
  recordedAt: string;
  /** activity_log.id of the freshly-written row. */
  activityLogId: string;
}

/**
 * Keep-intent request shape — `POST /api/actions/keep-intent`.
 *
 * Records the user's Keep verdict for a sender (D40 — "Keep applies
 * immediately, records sender_policy(policy_type=keep)"). Keep is
 * policy/verdict-only per the Action Registry (manifest-entries.ts:
 * `keep.execution.kind === 'policy-only'`): no Gmail mutation, no
 * worker job, no undo token. Wired for the Triage daily ritual (D29 /
 * D226) so a Keep decision durably leaves the queue.
 */
export const keepIntentRequestSchema = z
  .object({
    senderId: z.string().uuid(),
  })
  .strict();
export type KeepIntentRequest = z.infer<typeof keepIntentRequestSchema>;

/**
 * Keep-intent response — mirrors `UnsubscribeIntentResult` so the FE
 * intent hooks share one shape.
 */
export interface KeepIntentResult {
  senderId: string;
  /** ISO timestamp the verdict was recorded. */
  recordedAt: string;
  /** activity_log.id of the keep decision row (fresh or replayed). */
  activityLogId: string;
}

// Derived from the canonical pg_enum so adding a status is a single
// migration edit. The contract block at the bottom of this file asserts
// the API type matches the shared zero-server-dep mirror.
export type { ActionJobStatus } from '@declutrmail/db';
import type { ActionJobStatus } from '@declutrmail/db';

export interface ActionEnqueueResult {
  actionId: string;
  /**
   * The number of messages the BE RESOLVED at enqueue time — not the
   * caller's raw `messageIds.length` ask. Semantic differs by selector
   * type (the schema discriminant on `archiveSelectorSchema` is `type`,
   * NOT `kind` — typo fix 2026-06-05 type-design-analyzer):
   *
   *   - `selector.type === 'sender'`   → count of the sender's inbox
   *      messages at this instant (whatever the worker is about to
   *      archive). Equal to `ArchivePreviewResult.inboxCount` from a
   *      preview taken in the same instant.
   *   - `selector.type === 'messages'` → length of the messageIds
   *      array AFTER ownership filtering (forged or cross-mailbox ids
   *      are dropped silently); may be strictly less than the caller's
   *      `messageIds.length`.
   *
   * NOTE: `ActionEnqueueResult` does NOT carry the selector itself —
   * the discriminant lives on the request body, not the response. The
   * comment documents the semantic of `requestedCount` per the request
   * shape the caller already sent.
   *
   * Surfaces in the FE receipt strip ("Archived X of Y") and the
   * confirm modal. The FE should treat this as the authoritative
   * "what we're about to do" number — it survives until `affectedCount`
   * lands in the terminal `ActionStatusResult`.
   */
  requestedCount: number;
  status: ActionJobStatus;
}

export interface ActionStatusResult {
  actionId: string;
  status: ActionJobStatus;
  /** Same semantics as `ActionEnqueueResult.requestedCount` — see above. */
  requestedCount: number;
  affectedCount: number;
  undoToken: string | null;
  errorCode: string | null;
}

/**
 * Non-mutating archive preview (D226). `inboxCount` is the REAL number of
 * the sender's messages currently labelled INBOX — the exact set the
 * archive will move — so the confirm modal states what actually changes
 * instead of a client-side estimate.
 */
export interface ArchivePreviewResult {
  senderId: string;
  inboxCount: number;
}

/* ─────────────────────────── ADR-0020 — unified composite action shape ────────────────────────── */

/**
 * Primary verbs allowed on the unified `POST /api/actions` endpoint.
 * Mirrors the FE Verb Registry's `VerbId` union (K/A/U/L/D — ADR-0019)
 * minus any verb that does not produce an `action_jobs` row at this
 * stage. Today the BE pipeline supports `archive` end-to-end; `delete`
 * routes through the same label-modify worker via the TRASH labelId
 * (manifest-entries.ts:delete.execution.buildLabelChange); `later` is
 * enum-ready but worker landing is deferred; `unsubscribe` + `keep`
 * never produce an action_jobs row.
 *
 * Scope guard: enum-validated by Zod so a forged client value 400s
 * cleanly with `INVALID_REQUEST` instead of leaking past the controller.
 */
// Verb set derived from the SHARED const so the FE + BE cannot drift
// (type-design-analyzer 2026-06-05). A new primary verb added to the
// shared array propagates here on next typecheck. The cast preserves
// the literal tuple identity for `z.enum` (which requires a non-empty
// readonly tuple of literal strings).
import { COMPOSITE_PRIMARY_VERBS } from '@declutrmail/shared/contracts';
export const compositePrimaryVerbSchema = z.enum(
  COMPOSITE_PRIMARY_VERBS as unknown as readonly [
    (typeof COMPOSITE_PRIMARY_VERBS)[number],
    ...(typeof COMPOSITE_PRIMARY_VERBS)[number][],
  ],
);
export type CompositePrimaryVerb = (typeof COMPOSITE_PRIMARY_VERBS)[number];

/**
 * Secondary historic-action verbs (ADR-0020). Optional. Applies only
 * when primary ∈ { 'unsubscribe', 'later' } per spec v1.2 Decision 15
 * ("Also act on past emails" toggle). Acts on the sender's historic
 * mail in the inbox via the same label-modify pipeline as the primary.
 *
 * Today's primary set above does NOT include 'unsubscribe' because
 * the unsubscribe pipeline is its own kind (manifest-entries.ts:
 * unsubscribe.execution.kind === 'unsubscribe'); the composite secondary
 * column is reserved for when that pipeline lands.
 */
import { COMPOSITE_SECONDARY_VERBS } from '@declutrmail/shared/contracts';
export const compositeSecondaryVerbSchema = z.enum(
  COMPOSITE_SECONDARY_VERBS as unknown as readonly [
    (typeof COMPOSITE_SECONDARY_VERBS)[number],
    ...(typeof COMPOSITE_SECONDARY_VERBS)[number][],
  ],
);
export type CompositeSecondaryVerb = (typeof COMPOSITE_SECONDARY_VERBS)[number];

/**
 * Composite action request body — spec v1.2 Decision 15 wire shape.
 *
 *   {
 *     selector: { type: 'sender', senderId: '<uuid>' },
 *     primary:   { type: 'archive', olderThanDays: 180 },
 *     secondary: { type: 'delete',  olderThanDays: 365 }   // optional
 *   }
 *
 * Time-window range (1..3650 days) matches the DB CHECK constraint on
 * `action_jobs.older_than_days` so a client value outside the range
 * 400s here instead of failing at INSERT.
 */
export const compositeActionRequestSchema = z
  .object({
    selector: archiveSelectorSchema,
    primary: z
      .object({
        type: compositePrimaryVerbSchema,
        olderThanDays: z.number().int().min(1).max(3650).nullable().optional(),
      })
      .strict(),
    secondary: z
      .object({
        type: compositeSecondaryVerbSchema,
        olderThanDays: z.number().int().min(1).max(3650).nullable().optional(),
      })
      .strict()
      .optional(),
    /** Required to act on a Protected / VIP sender (defense-in-depth, D42). */
    override: z.boolean().optional(),
  })
  .strict();
export type CompositeActionRequest = z.infer<typeof compositeActionRequestSchema>;

/**
 * Composite enqueue response (ADR-0020). Two ids returned when the
 * secondary fires; the primary's `actionId` is the same as `compositeId`
 * (it's the parent row). FE undo via `undoToken` cascades through the
 * `composite_id` index on the action_jobs table.
 */
export interface CompositeActionEnqueueResult {
  actionId: string;
  compositeId: string;
  secondaryId: string | null;
  status: ActionJobStatus;
  /** Resolved primary count (same semantic as ActionEnqueueResult). */
  primaryCount: number;
  /** Resolved secondary count, or null when no secondary fired. */
  secondaryCount: number | null;
}

/**
 * Composite preview (ADR-0020) — returns the sender context strip +
 * counts per time-window bucket so the FE can render the chip row with
 * accurate per-preset counts without a second roundtrip. Buckets are
 * locked to the FE preset chips: 30d / 90d / 180d / 365d. `all` is the
 * un-windowed count (= existing `ArchivePreviewResult.inboxCount` for
 * primary=archive).
 */
export interface CompositeActionPreviewResult {
  sender: {
    id: string;
    name: string;
    domain: string;
    lastSeenDays: number | null;
    /** `senders.replied_count` (mig 0022) — `null` only when sender
     *  row pre-dates the backfill. The sender-context strip renders
     *  `you replied N×` from this value. */
    repliedCount: number | null;
    monthly: number | null;
  };
  counts: {
    all: number;
    olderThan30d: number;
    olderThan90d: number;
    olderThan180d: number;
    olderThan365d: number;
  };
  /**
   * Top 5 most-recent subjects per time-window for the "Show what will
   * move" trust panel (spec v1.3 — recent beats oldest for 3-sec sender
   * recognition). Each array is ordered by `internal_date DESC`,
   * capped at 5. Empty array when no messages match the window.
   * `subject` is D7-allowlisted (sender + subject + snippet + dates +
   * labels + read state) — no body, no attachment, no other header
   * surfaces here.
   */
  recentSubjects: {
    all: string[];
    olderThan30d: string[];
    olderThan90d: string[];
    olderThan180d: string[];
    olderThan365d: string[];
  };
  unsubAvailable: boolean;
  protected: boolean;
}

/**
 * Cross-package contract — assert the DB-derived `ActionJobStatus`
 * stays equal to the shared zero-server-dep mirror in
 * `@declutrmail/shared/contracts`. If either narrows or widens, one
 * of these two assertions fails-compile.
 */
import type { ActionJobStatus as SharedActionJobStatus } from '@declutrmail/shared/contracts';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _ACTION_JOB_STATUS_API_EXTENDS_SHARED: ActionJobStatus extends SharedActionJobStatus
  ? true
  : false = true;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _ACTION_JOB_STATUS_SHARED_EXTENDS_API: SharedActionJobStatus extends ActionJobStatus
  ? true
  : false = true;
