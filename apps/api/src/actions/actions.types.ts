import { z } from 'zod';
import type { ActionStatusSnapshot } from '@declutrmail/shared/actions';
import {
  UnsubscribeManualStatusRequestSchema,
  type UnsubscribeLifecycleStatus,
  type UnsubscribeManualStatusRequest,
  type UnsubscribeManualTransition,
} from '@declutrmail/shared/contracts';

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
    /** Required to act on a Protected sender (defense-in-depth, D42). */
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

/** Explicit progress update for the manual mailto unsubscribe path. */
export const unsubscribeManualStatusRequestSchema = UnsubscribeManualStatusRequestSchema;
export type { UnsubscribeManualStatusRequest };

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
  /** Truthful method-specific state after recording (or replaying) the intent. */
  lifecycleStatus: UnsubscribeLifecycleStatus;
  /**
   * The sender's unsubscribe capability at intent time (ADR-0006
   * derivation; `none` when the sender carries no method). Drives the
   * FE's three-state copy (D9 Wave 2):
   *   - `one_click` → "confirming with <domain>…" + poll
   *     `executionActionId` for the outcome.
   *   - `mailto`    → manual Gmail-compose affordance (D230 — the
   *     user sends the opt-out themselves; `mailtoUrl` is the address).
   *   - `none`      → no unsubscribe channel; archive is the fallback.
   */
  method: 'one_click' | 'mailto' | 'none';
  /**
   * `action_jobs.id` of the enqueued RFC 8058 execution job — poll at
   * `GET /api/actions/:id` until terminal. NULL unless `method` is
   * `one_click`. NO undo token will ever accompany the terminal state
   * (D58 — a delivered network unsubscribe is one-way).
   */
  executionActionId: string | null;
  /**
   * Raw `mailto:` URL from the sender's List-Unsubscribe header (D230
   * manual path). NULL unless `method` is `mailto`. The FE parses it
   * into a Gmail compose deep link — DeclutrMail never auto-sends.
   */
  mailtoUrl: string | null;
}

/** Result of an explicit manual-mailto progress transition. */
export interface UnsubscribeManualStatusResult {
  senderId: string;
  status: UnsubscribeManualTransition;
  /** ISO timestamp of the transition, or the current policy update on an idempotent replay. */
  recordedAt: string;
  /** Fresh Activity outcome row; null when the requested state already held. */
  activityLogId: string | null;
  changed: boolean;
  /** True only for user_marked_sent, which cannot be regressed in-app. */
  irreversible: boolean;
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

/**
 * Poll result shared with the web client. The original fields remain intact;
 * verb/schedule/Undo timing are additive facts used to derive the canonical
 * D245 receipt without another request.
 */
export type ActionStatusResult = ActionStatusSnapshot;

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
 * Max senders accepted by one bulk (multi-sender) action / preview
 * request. ADR-0020 "Bulk variant" caps the resolved sender set at
 * 1,000 (D-Q1).
 */
export const BULK_SENDERS_MAX = 1000;

/**
 * Composite selector — the single-sender / messages selectors plus the
 * D52 multi-sender `senders` variant. `senders` fans out server-side to
 * one `action_jobs` row per sender (per-sender failure isolation) linked
 * via `composite_id` so the batch shares one cascade-undo group
 * (ADR-0020). Min 2 — a single sender uses the `sender` selector.
 */
export const compositeSelectorSchema = z.discriminatedUnion('type', [
  ...archiveSelectorSchema.options,
  z
    .object({
      type: z.literal('senders'),
      senderIds: z.array(z.string().uuid()).min(2).max(BULK_SENDERS_MAX),
    })
    .strict(),
]);
export type CompositeSelector = z.infer<typeof compositeSelectorSchema>;

/**
 * Composite action request body — spec v1.2 Decision 15 wire shape.
 *
 *   {
 *     selector: { type: 'sender', senderId: '<uuid>' },
 *     primary:   { type: 'archive', olderThanDays: 180 },
 *     secondary: { type: 'delete',  olderThanDays: 365 }   // optional
 *   }
 *
 * The D52 bulk variant uses the same endpoint with
 * `selector: { type: 'senders', senderIds: [...] }` per ADR-0020
 * ("Bulk-action enqueue uses the same POST /api/actions endpoint").
 *
 * Time-window range (1..3650 days) matches the DB CHECK constraint on
 * `action_jobs.older_than_days` so a client value outside the range
 * 400s here instead of failing at INSERT.
 */
export const compositeActionRequestSchema = z
  .object({
    selector: compositeSelectorSchema,
    primary: z
      .object({
        type: compositePrimaryVerbSchema,
        olderThanDays: z.number().int().min(1).max(3650).nullable().optional(),
        /** D245: Later is always scheduled; other verbs cannot carry a wake time. */
        wakeAt: z.string().datetime({ offset: true }).optional(),
      })
      .strict(),
    secondary: z
      .object({
        type: compositeSecondaryVerbSchema,
        olderThanDays: z.number().int().min(1).max(3650).nullable().optional(),
      })
      .strict()
      .optional(),
    /** Required to act on a Protected sender (defense-in-depth, D42). */
    override: z.boolean().optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.primary.type === 'later') {
      if (body.selector.type === 'messages') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['selector'],
          message: 'Later is scheduled per sender, not per message selection.',
        });
      }
      if (body.primary.wakeAt === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['primary', 'wakeAt'],
          message: 'Later requires a wake time.',
        });
      } else if (Date.parse(body.primary.wakeAt) <= Date.now()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['primary', 'wakeAt'],
          message: 'Wake time must be in the future.',
        });
      }
    } else if (body.primary.wakeAt !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['primary', 'wakeAt'],
        message: 'wakeAt is only valid for Later.',
      });
    }
  });
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
  /** Selected Later wake time; null for Archive/Delete. */
  wakeAt: string | null;
}

/**
 * Bulk enqueue response (D52 + ADR-0020 bulk variant). `batchId` is the
 * anchor row's id — every other row in the batch carries
 * `composite_id = batchId`, so `GET /api/actions/batch/:batchId`
 * aggregates the whole fan-out and `POST /api/undo/:token` (any sibling
 * token) cascade-reverts the batch.
 *
 * `skipped` reports senders the fan-out did NOT enqueue — per-sender
 * failure isolation at the enqueue boundary: a Protected or
 * unknown sender never poisons the rest of the selection.
 */
export interface BulkActionEnqueueResult {
  batchId: string;
  status: ActionJobStatus;
  /** Senders actually enqueued (after skips). */
  senderCount: number;
  /** Sum of per-sender primary `requestedCount`s. */
  requestedTotal: number;
  /** Shared Later wake time for every sender in this batch. */
  wakeAt: string | null;
  skipped: Array<{ senderId: string; reason: 'protected' | 'not_found' }>;
}

/**
 * Bulk preview request — `POST /api/actions/preview/bulk` (ADR-0020
 * "Bulk variant"; D52 aggregated-impact action sheet). Explicit
 * sender ids only at this build — the filter-object variant lands with
 * bulk-by-filter.
 */
export const bulkPreviewRequestSchema = z
  .object({
    senderIds: z.array(z.string().uuid()).min(2).max(BULK_SENDERS_MAX),
  })
  .strict();
export type BulkPreviewRequest = z.infer<typeof bulkPreviewRequestSchema>;

/** Per-time-window bucket counts (same shape as the single-sender preview). */
export interface BulkPreviewBuckets {
  all: number;
  olderThan30d: number;
  olderThan90d: number;
  olderThan180d: number;
  olderThan365d: number;
}

/**
 * Bulk preview response (D52): per-sender breakdown + aggregate counts
 * across the selection so the D226 preview states REAL numbers, never a
 * client estimate. `totals` excludes Protected senders — the
 * enqueue skips them, so the preview must match what will actually
 * move. Unknown / cross-mailbox ids are dropped (ownership), mirroring
 * the messages-selector forged-id drop.
 */
export interface BulkActionPreviewResult {
  senders: Array<{
    senderId: string;
    name: string;
    counts: BulkPreviewBuckets;
    protected: boolean;
  }>;
  totals: BulkPreviewBuckets;
  protectedCount: number;
}

/**
 * Batch status (D52) — `GET /api/actions/batch/:batchId`. Aggregates
 * every forward sibling of the batch (anchor + `composite_id` children)
 * so the FE polls ONE handle per batch instead of N. `undoToken` is the
 * anchor's token when present, else the first sibling token — any
 * sibling token cascade-reverts the whole batch (ADR-0020 cascade-undo).
 *
 * `status` derivation: all-queued → 'queued'; any progress → 'executing';
 * all terminal → 'failed' when every row failed, else 'done' (partial
 * failures surface via `failed`).
 */
export interface BatchStatusResult {
  batchId: string;
  status: ActionJobStatus;
  /** Forward sibling rows in the batch (primaries + any secondaries). */
  total: number;
  done: number;
  failed: number;
  requestedCount: number;
  affectedCount: number;
  undoToken: string | null;
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
