/**
 * Async destructive-action pipeline client (D226).
 *
 * The senders surface enqueues a single-sender Archive, then polls the
 * action handle until the worker reports `done` (carrying the real
 * `undoToken`) or `failed`. Undo reverses a completed action by token,
 * which itself enqueues a reverse job the caller polls the same way.
 *
 * Idempotency (D202): every enqueue carries an `Idempotency-Key` header —
 * one fresh key per user click (`newIdempotencyKey`). A network-retried
 * click returns the same action; a fresh click is a new action. The undo
 * route uses the token itself as the idempotency key (no header).
 *
 * Only `archive` is wired end-to-end today (BE `POST /actions/archive` +
 * archive-only undo). `later` / `unsubscribe` have no enqueue route yet.
 */

import type {
  ActionJobStatus,
  ActionReach,
  UndoActionKind,
  UnsubscribeLifecycleStatus,
  UnsubscribeManualTransition,
} from '@declutrmail/shared/contracts';
import { UNSUB_AMBIGUOUS_REDIRECT_ERROR_CODE } from '@declutrmail/shared/contracts';
import { defaultLaterWakeAtIso } from '@declutrmail/shared/actions';
import type { ActionStatusSnapshot } from '@declutrmail/shared/actions';

import { apiGet, apiPost } from './client';

/** Lifecycle of an `action_jobs` row — mirrors the BE `ActionJobStatus`. */
export type { ActionJobStatus };

/** ADR-0028 — how far a Delete reaches. Absent on the wire = `inbox_only`. */
export type { ActionReach };

/** A status is terminal once the worker has finished (success or failure). */
export function isTerminalStatus(status: ActionJobStatus): boolean {
  return status === 'done' || status === 'failed';
}

/** Returned by `POST /api/actions/archive` — the action handle to poll. */
export interface ActionEnqueueResult {
  actionId: string;
  requestedCount: number;
  status: ActionJobStatus;
}

/* ────────── Outcome-aware Activity recovery ────────── */

export type ActionRecoveryPreviewStatus = 'verifying' | 'ready' | 'failed' | 'consumed';

export type ActionRecoveryOutcome =
  | 'not_applied'
  | 'partial'
  | 'already_applied'
  | 'no_change_needed'
  | 'uncertain'
  | 'reconnect_required'
  | 'blocked';

/** Provider-verified consequence preview for one failed label action. */
export interface ActionRecoveryPreviewResult {
  previewId: string;
  actionId: string;
  rootActionId: string;
  verb: 'archive' | 'later' | 'delete';
  status: ActionRecoveryPreviewStatus;
  outcome: ActionRecoveryOutcome | null;
  targetCount: number;
  remainingCount: number;
  alreadyAppliedCount: number;
  unavailableCount: number;
  verifiedCount: number;
  errorCode: string | null;
  wakeAt: string | null;
  requiresNewWakeAt: boolean;
  expiresAt: string;
  recoveryActionId: string | null;
}

export interface ActionRecoveryEnqueueResult {
  previewId: string;
  rootActionId: string;
  actionId: string;
  attempt: number;
  status: ActionJobStatus;
  replayed: boolean;
}

/** Begin metadata-only Gmail verification; this call never mutates mail. */
export async function createActionRecoveryPreview(
  actionId: string,
): Promise<ActionRecoveryPreviewResult> {
  const env = await apiPost<ActionRecoveryPreviewResult>(
    `/api/actions/${encodeURIComponent(actionId)}/recovery-preview`,
  );
  return env.data;
}

/** Poll a durable recovery preview until verification reaches a terminal state. */
export async function getActionRecoveryPreview(
  previewId: string,
  options: { signal?: AbortSignal } = {},
): Promise<ActionRecoveryPreviewResult> {
  const env = await apiGet<ActionRecoveryPreviewResult>(
    `/api/actions/recovery-previews/${encodeURIComponent(previewId)}`,
    options.signal ? { signal: options.signal } : {},
  );
  return env.data;
}

/**
 * Confirm the verified consequence preview. The same key is retained for
 * every network replay of this confirmation so double-clicks enqueue one
 * recovery attempt.
 */
export async function confirmActionRecovery(
  previewId: string,
  input: { idempotencyKey: string; wakeAt?: string },
): Promise<ActionRecoveryEnqueueResult> {
  const env = await apiPost<ActionRecoveryEnqueueResult>(
    `/api/actions/recovery-previews/${encodeURIComponent(previewId)}/retry`,
    input.wakeAt ? { wakeAt: input.wakeAt } : {},
    { headers: { 'Idempotency-Key': input.idempotencyKey } },
  );
  return env.data;
}

/** Returned by `GET /api/actions/:id` — canonical shared poll snapshot. */
export type ActionStatusResult = ActionStatusSnapshot;

/** Returned by `POST /api/undo/:token` — the reverse handle to poll. */
export interface UndoRevertResult {
  token: string;
  /**
   * The verb being reverted — closed enum mirrored from the BE
   * `UndoActionKind` (and ultimately the `undo_action_kind` pg_enum).
   * Tightening this from `string` keeps the discriminated-union story
   * intact at the wire seam: a future consumer that branches on
   * `actionKind` will fail-compile if it forgets a case.
   */
  actionKind: UndoActionKind;
  /** True when the reverse already completed (idempotent repeat POST). */
  reverted: boolean;
  expired: boolean;
  revertedAt: string | null;
  /** Reverse `action_jobs` id to poll via `getActionStatus`; null when already reverted. */
  actionId: string | null;
}

/**
 * Fresh idempotency key — one per user click. `crypto.randomUUID` is
 * available in every browser the app targets and in the jsdom/Node test
 * runtime. Satisfies the BE's ≥8-char requirement.
 */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

/** Per-request options shared by the action calls. */
interface ActionRequestOptions {
  mailboxId?: string | undefined;
}

/** Poll one action's status. Mailbox-scoped → 404 if not owned. */
export async function getActionStatus(
  actionId: string,
  options: ActionRequestOptions = {},
): Promise<ActionStatusResult> {
  const env = await apiGet<ActionStatusResult>(`/api/actions/${actionId}`, {
    ...(options.mailboxId ? { mailboxId: options.mailboxId } : {}),
  });
  return env.data;
}

/**
 * Reverse a completed action by its undo token. Enqueues a reverse job;
 * the caller polls `getActionStatus(result.actionId)` until `done`. A
 * repeat POST is idempotent (the token is the key).
 */
export async function revertUndo(
  token: string,
  options: ActionRequestOptions = {},
): Promise<UndoRevertResult> {
  const env = await apiPost<UndoRevertResult>(`/api/undo/${token}`, undefined, {
    ...(options.mailboxId ? { mailboxId: options.mailboxId } : {}),
  });
  return env.data;
}

/* ─────────────────────── ADR-0020 — unified composite client ─────────────────────── */

/** Primary verb accepted by `POST /api/actions`. Spec v1.2 Decision 15. */
// Derived from the shared const so FE/BE cannot drift (type-design-
// analyzer 2026-06-05).
import type {
  CompositePrimaryVerb,
  CompositeSecondaryVerb,
  LabelCompositePrimaryVerb,
} from '@declutrmail/shared/contracts';
export type { CompositePrimaryVerb, CompositeSecondaryVerb, LabelCompositePrimaryVerb };
/** Secondary historic verb — applies on Unsubscribe / Later primaries. */
// CompositeSecondaryVerb re-exported above.

/** Returned by `POST /api/actions` — composite enqueue handle. */
export interface CompositeActionEnqueueResult {
  actionId: string;
  compositeId: string;
  secondaryId: string | null;
  status: ActionJobStatus;
  primaryCount: number;
  secondaryCount: number | null;
  wakeAt: string | null;
}

/**
 * One row in the composite preview's "what currently matches" sample.
 * `date` is the message's Gmail `internal_date` as an ISO string — the
 * SAME column every preview bucket filters on, so a reader can verify
 * the sample respects the window they selected.
 */
export interface CompositePreviewMessage {
  subject: string;
  /**
   * ISO `internal_date`, or `null` when the server did not supply one.
   *
   * Nullable on purpose. `apps/api` (Cloud Run) and `apps/web` (Vercel)
   * deploy INDEPENDENTLY, so every wire-shape change has a skew window in
   * both directions. This field arrived as a bare `string[]` before
   * 2026-07-27; a reader that assumes the object shape renders a plain
   * object as a React child and throws, taking down the D226 confirm
   * modal. `normalizePreviewMessages` below absorbs either shape at the
   * boundary so the rest of the app sees one type, and a missing date
   * renders as no date rather than a guess.
   */
  date: string | null;
}

/** Either shape the preview endpoint may be serving during a deploy skew. */
type WirePreviewMessage = string | { subject?: unknown; date?: unknown };

/**
 * Coerce the wire's sample rows to `CompositePreviewMessage[]`. Defensive
 * parsing at an external boundary, not transitional shim code: the same
 * discipline as `toCount` on the server side.
 */
export function normalizePreviewMessages(raw: unknown): CompositePreviewMessage[] {
  if (!Array.isArray(raw)) return [];
  return (raw as WirePreviewMessage[]).flatMap((row) => {
    if (typeof row === 'string') return [{ subject: row, date: null }];
    if (row === null || typeof row !== 'object') return [];
    const subject = typeof row.subject === 'string' ? row.subject : '';
    const date =
      typeof row.date === 'string' && Number.isFinite(Date.parse(row.date)) ? row.date : null;
    return [{ subject, date }];
  });
}

/** Returned by `GET /api/actions/preview` — composite preview shape. */
export interface CompositeActionPreviewResult {
  sender: {
    id: string;
    name: string;
    domain: string;
    lastSeenDays: number | null;
    /** `senders.replied_count` from mig 0022 — drives the
     *  sender-context-strip "you replied N×" copy. */
    wroteToCount: number | null;
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
   * Top 5 most-recent messages per time-window for the "Show what will
   * move" trust panel (spec v1.3 — recent beats oldest for 3-sec sender
   * recognition). Ordered by `internal_date DESC`, capped at 5. Empty
   * when no messages match the window.
   *
   * Carries `date` (the message's `internal_date`, ISO) alongside the
   * subject: on a windowed action the panel shows the 5 most recent
   * WITHIN that bucket, and without a date the user cannot check the
   * sample respects the window they picked. Both fields are
   * D7-allowlisted (sender + subject + snippet + dates + labels + read
   * state) — no body, no attachment, no other header surfaces here.
   */
  recentMessages: {
    all: CompositePreviewMessage[];
    olderThan30d: CompositePreviewMessage[];
    olderThan90d: CompositePreviewMessage[];
    olderThan180d: CompositePreviewMessage[];
    olderThan365d: CompositePreviewMessage[];
  };
  /**
   * ADR-0028 — the same counts + samples at `all_mail` reach (inbox +
   * archived), powering the Delete modal's "Inbox + archived" chip.
   * `null` when the API predates the field (deploy skew): the modal
   * simply does not offer the reach choice against an older server.
   */
  allMail: {
    counts: {
      all: number;
      olderThan30d: number;
      olderThan90d: number;
      olderThan180d: number;
      olderThan365d: number;
    };
    recentMessages: {
      all: CompositePreviewMessage[];
      olderThan30d: CompositePreviewMessage[];
      olderThan90d: CompositePreviewMessage[];
      olderThan180d: CompositePreviewMessage[];
      olderThan365d: CompositePreviewMessage[];
    };
  } | null;
  unsubAvailable: boolean;
  protected: boolean;
}

/**
 * Enqueue a unified composite action (ADR-0020). Single-verb shape omits
 * `secondary`; composite shape includes it. The BE handles both through
 * one path so the FE can talk to ONE endpoint regardless of selection.
 */
export async function enqueueCompositeAction(
  input: {
    senderId: string;
    primary: {
      // D248 — the SINGLE-sender composite is label verbs only.
      // `unsubscribe` is multi-sender only (a single sender keeps its
      // own intent route, which owns the mailto compose hand-off), so
      // the server 400s it. The narrowed type refuses it at compile
      // time instead, matching the BE's own signature.
      type: LabelCompositePrimaryVerb;
      olderThanDays?: number | null;
      wakeAt?: string;
      /** ADR-0028 — omit for `inbox_only` (Delete-only field). */
      reach?: ActionReach;
    };
    secondary?: { type: CompositeSecondaryVerb; olderThanDays?: number | null };
    override?: boolean;
    idempotencyKey: string;
  } & ActionRequestOptions,
): Promise<CompositeActionEnqueueResult> {
  const env = await apiPost<CompositeActionEnqueueResult>(
    '/api/actions',
    {
      selector: { type: 'sender', senderId: input.senderId },
      primary: withRequiredLaterWakeAt(input.primary),
      ...(input.secondary ? { secondary: input.secondary } : {}),
      override: input.override ?? false,
    },
    {
      headers: { 'Idempotency-Key': input.idempotencyKey },
      ...(input.mailboxId ? { mailboxId: input.mailboxId } : {}),
    },
  );
  return env.data;
}

/**
 * Composite preview — sender context strip + per-time-window bucket counts
 * for the confirm modal chip row. One round-trip pulls every chip count so
 * the modal opens without a second fetch (ADR-0020).
 */
/**
 * Returned by `POST /api/actions/unsubscribe-intent` — the user's
 * recorded intent to unsubscribe from a sender, plus the execution
 * handle (D9 Wave 2). The endpoint upserts `sender_policies.policy_
 * type='unsubscribe'`, writes a 0-affected `activity_log` row, and —
 * for `one_click` senders — enqueues the real RFC 8058 execution.
 */
export interface UnsubscribeIntentResult {
  senderId: string;
  /** ISO timestamp the intent was recorded server-side. */
  recordedAt: string;
  /** activity_log.id of the freshly-written row. */
  activityLogId: string;
  /** Method-specific progress; never implies future delivery has stopped. */
  lifecycleStatus: UnsubscribeLifecycleStatus;
  /**
   * The sender's unsubscribe capability at intent time:
   *   - `one_click` → an execution job is in flight; poll
   *     `executionActionId` via `getActionStatus` for the outcome.
   *   - `mailto`    → manual path (D230) — open the Gmail compose
   *     deep link built from `mailtoUrl`; the USER sends it.
   *   - `none`      → we looked; the sender publishes no unsubscribe.
   *
   * A sender the index has NOT derived a method for (`unknown`, D248) is
   * never recorded: the route answers 409 `UNSUBSCRIBE_CHANNEL_UNKNOWN`
   * instead, because writing "no unsubscribe channel available" for a
   * sender we never checked would state a fact we do not have.
   */
  method: 'one_click' | 'mailto' | 'none';
  /**
   * `action_jobs.id` of the RFC 8058 execution — poll until terminal.
   * `done` = unsubscribed; `failed` + errorCode
   * `UNSUB_AMBIGUOUS_REDIRECT` = unconfirmed (3xx); other `failed` =
   * the list refused / unreachable. NO undo token ever accompanies it
   * (D58 — a delivered network unsubscribe is one-way). Null unless
   * `method === 'one_click'`.
   */
  executionActionId: string | null;
  /** Raw `mailto:` URL for the manual path. Null unless `method === 'mailto'`. */
  mailtoUrl: string | null;
}

export interface UnsubscribeManualStatusResult {
  senderId: string;
  status: UnsubscribeManualTransition;
  recordedAt: string;
  activityLogId: string | null;
  changed: boolean;
  irreversible: boolean;
}

/** `action_jobs.error_code` marking a 3xx (unconfirmed) unsub outcome. */
export const UNSUB_AMBIGUOUS_ERROR_CODE = UNSUB_AMBIGUOUS_REDIRECT_ERROR_CODE;

/**
 * Record an unsubscribe intent for a sender. Replaces the prior
 * tracer toast (which lied — said "Unsubscribed" with no BE call) per
 * the 2026-06-05 founder brainstorm. CLAUDE.md §10 no-fake-completion.
 *
 * Idempotency-Key (D202): every call sends a fresh key by default; a
 * network-retry of the SAME mutation dedups at the BE (action_jobs
 * idempotency_key unique). The caller may supply a key explicitly to
 * collapse multiple click handlers — TanStack Query's retry path passes
 * the same key automatically.
 */
export async function recordUnsubscribeIntent(
  senderId: string,
  options: ActionRequestOptions & {
    idempotencyKey?: string;
    includesBacklogAction?: boolean;
  } = {},
): Promise<UnsubscribeIntentResult> {
  const idempotencyKey = options.idempotencyKey ?? newIdempotencyKey();
  const env = await apiPost<UnsubscribeIntentResult>(
    '/api/actions/unsubscribe-intent',
    {
      senderId,
      // Preserve the old strict body when omitted; explicit false/true
      // are forwarded so callers can state the exact quota preflight.
      ...(options.includesBacklogAction !== undefined
        ? { includesBacklogAction: options.includesBacklogAction }
        : {}),
    },
    {
      headers: { 'Idempotency-Key': idempotencyKey },
      ...(options.mailboxId ? { mailboxId: options.mailboxId } : {}),
    },
  );
  return env.data;
}

/** Persist an explicit step in the user-sent mailto unsubscribe flow. */
export async function recordUnsubscribeManualStatus(
  senderId: string,
  status: UnsubscribeManualTransition,
  options: ActionRequestOptions = {},
): Promise<UnsubscribeManualStatusResult> {
  const env = await apiPost<UnsubscribeManualStatusResult>(
    '/api/actions/unsubscribe-manual-status',
    { senderId, status },
    { ...(options.mailboxId ? { mailboxId: options.mailboxId } : {}) },
  );
  return env.data;
}

export async function getCompositePreview(
  senderId: string,
  options: ActionRequestOptions = {},
): Promise<CompositeActionPreviewResult> {
  const env = await apiGet<CompositeActionPreviewResult>('/api/actions/preview', {
    query: { senderId },
    ...(options.mailboxId ? { mailboxId: options.mailboxId } : {}),
  });
  // Absorb the wire HERE, at the one boundary the sample enters through.
  //
  // `recentMessages` (dated) is the current field; `recentSubjects`
  // (subjects-only) is what an API built before 2026-07-27 sends. Reading
  // whichever is present keeps a NEW web bundle working against an OLD
  // API. The API keeps emitting BOTH, which is what keeps an OLD web
  // bundle working against a NEW API — the two services deploy
  // independently, so both directions need covering.
  const wire = env.data as unknown as {
    recentMessages?: Record<string, unknown>;
    recentSubjects?: Record<string, unknown>;
    allMail?: {
      counts?: Record<string, unknown>;
      recentMessages?: Record<string, unknown>;
    } | null;
  };
  const raw = wire.recentMessages ?? wire.recentSubjects;
  return {
    ...env.data,
    recentMessages: {
      all: normalizePreviewMessages(raw?.all),
      olderThan30d: normalizePreviewMessages(raw?.olderThan30d),
      olderThan90d: normalizePreviewMessages(raw?.olderThan90d),
      olderThan180d: normalizePreviewMessages(raw?.olderThan180d),
      olderThan365d: normalizePreviewMessages(raw?.olderThan365d),
    },
    // ADR-0028: absent (older API) or malformed → null, and the modal
    // does not offer the reach choice. Same boundary discipline as the
    // sample rows above.
    allMail: normalizeAllMailBlock(wire.allMail),
  };
}

/** Coerce the wire's ADR-0028 `allMail` block; `null` = unavailable. */
function normalizeAllMailBlock(
  raw:
    | { counts?: Record<string, unknown>; recentMessages?: Record<string, unknown> }
    | null
    | undefined,
): CompositeActionPreviewResult['allMail'] {
  const counts = raw?.counts;
  if (!counts) return null;
  const bucket = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return {
    counts: {
      all: bucket(counts.all),
      olderThan30d: bucket(counts.olderThan30d),
      olderThan90d: bucket(counts.olderThan90d),
      olderThan180d: bucket(counts.olderThan180d),
      olderThan365d: bucket(counts.olderThan365d),
    },
    recentMessages: {
      all: normalizePreviewMessages(raw?.recentMessages?.all),
      olderThan30d: normalizePreviewMessages(raw?.recentMessages?.olderThan30d),
      olderThan90d: normalizePreviewMessages(raw?.recentMessages?.olderThan90d),
      olderThan180d: normalizePreviewMessages(raw?.recentMessages?.olderThan180d),
      olderThan365d: normalizePreviewMessages(raw?.recentMessages?.olderThan365d),
    },
  };
}

/* ─────────────────────── D52 — multi-sender bulk client ─────────────────────── */

/** Per-time-window bucket counts (same shape as the single-sender preview). */
export interface BulkPreviewBuckets {
  all: number;
  olderThan30d: number;
  olderThan90d: number;
  olderThan180d: number;
  olderThan365d: number;
}

/**
 * Returned by `POST /api/actions/preview/bulk` — per-sender breakdown +
 * aggregate bucket counts across the selection (D52: the action sheet
 * shows AGGREGATED impact). `totals` excludes Protected senders
 * because the bulk enqueue skips them — the preview equals what will
 * actually move.
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
 * Returned by `POST /api/actions` with the `senders` selector — the
 * batch handle to poll at `GET /api/actions/batch/:batchId`. `skipped`
 * reports senders the fan-out did not enqueue (protected / not found).
 */
export interface BulkActionEnqueueResult {
  batchId: string;
  status: ActionJobStatus;
  senderCount: number;
  requestedTotal: number;
  wakeAt: string | null;
  skipped: Array<{
    senderId: string;
    reason: BulkSkipReason;
    /**
     * The sender's `mailto:` opt-out address, present only on a `mailto`
     * skip (D230): the batch never sends it, the user does, from a
     * prefilled compose link.
     */
    mailtoUrl?: string;
  }>;
}

/**
 * Why a selected sender did not enter the batch. The label verbs
 * produce `protected` / `not_found`; an Unsubscribe batch (D248) adds
 * the three non-executable capability states, reported separately
 * because "send it yourself", "there is nothing to send" and "we have
 * not looked yet" are three different facts.
 */
export type BulkSkipReason = 'protected' | 'not_found' | 'mailto' | 'no_channel' | 'unknown';

/**
 * Returned by `GET /api/actions/batch/:id` — aggregate batch state.
 * Terminal when `status` is `done` or `failed`; partial failures keep
 * `status: 'done'` and surface via `failed > 0`. `undoToken` cascade-
 * reverts the WHOLE batch via the existing `POST /api/undo/:token`
 * (ADR-0020 cascade-undo walks the `composite_id` siblings).
 */
export interface BatchStatusResult {
  batchId: string;
  status: ActionJobStatus;
  total: number;
  done: number;
  failed: number;
  requestedCount: number;
  affectedCount: number;
  undoToken: string | null;
  /**
   * D248 — the three terminal outcomes the unsubscribe worker records,
   * counted across the batch. `null` for a label batch. Read THIS for
   * an unsubscribe receipt, never `done`/`failed`: an `unconfirmed` row
   * carries job status `failed`, and calling that a failure would round
   * "we could not establish what happened" into a fact.
   *
   * Optional on the wire so a web bundle newer than the API still
   * renders (apps/web and apps/api deploy independently).
   */
  unsubscribeOutcomes?: UnsubscribeBatchOutcomes | null;
}

/** Terminal one-click unsubscribe outcomes, counted across a batch. */
export interface UnsubscribeBatchOutcomes {
  /** The sender's endpoint accepted the request (2xx). Not "unsubscribed". */
  endpointAccepted: number;
  /** Sent; the outcome could not be established. Never rounded away. */
  unconfirmed: number;
  /** The request did not go through. */
  failed: number;
  /** Still queued or executing — no outcome yet. */
  pending: number;
}

/**
 * Aggregated multi-sender preview (D226-mandatory before any bulk
 * mutation). POST because the selection does not fit a query string —
 * the call itself is read-only.
 */
export async function getBulkActionPreview(
  senderIds: string[],
  options: ActionRequestOptions = {},
): Promise<BulkActionPreviewResult> {
  const env = await apiPost<BulkActionPreviewResult>(
    '/api/actions/preview/bulk',
    { senderIds },
    { ...(options.mailboxId ? { mailboxId: options.mailboxId } : {}) },
  );
  return env.data;
}

/**
 * Enqueue a multi-sender bulk action (D52). Same `POST /api/actions`
 * endpoint as the single-sender composite (ADR-0020 "Bulk variant"),
 * with the `senders` selector. One Idempotency-Key per bulk click —
 * the BE derives deterministic per-sender row keys from it.
 */
export async function enqueueBulkAction(
  input: {
    senderIds: string[];
    // Stays WIDE: the multi-sender selector is the one shape that
    // accepts the `unsubscribe` primary (D248).
    primary: { type: CompositePrimaryVerb; olderThanDays?: number | null; wakeAt?: string };
    secondary?: { type: CompositeSecondaryVerb; olderThanDays?: number | null };
    idempotencyKey: string;
  } & ActionRequestOptions,
): Promise<BulkActionEnqueueResult> {
  const env = await apiPost<BulkActionEnqueueResult>(
    '/api/actions',
    {
      selector: { type: 'senders', senderIds: input.senderIds },
      primary: withRequiredLaterWakeAt(input.primary),
      ...(input.secondary ? { secondary: input.secondary } : {}),
    },
    {
      headers: { 'Idempotency-Key': input.idempotencyKey },
      ...(input.mailboxId ? { mailboxId: input.mailboxId } : {}),
    },
  );
  return env.data;
}

/** Public web-client alias for the canonical D245 one-week preset. */
export const defaultLaterWakeAt = defaultLaterWakeAtIso;

function withRequiredLaterWakeAt(primary: {
  type: CompositePrimaryVerb;
  olderThanDays?: number | null;
  wakeAt?: string;
  reach?: ActionReach;
}): typeof primary {
  return primary.type === 'later' && primary.wakeAt === undefined
    ? { ...primary, wakeAt: defaultLaterWakeAt() }
    : primary;
}

/** Poll a batch's aggregate status. Mailbox-scoped → 404 if not owned. */
export async function getBatchStatus(
  batchId: string,
  options: ActionRequestOptions = {},
): Promise<BatchStatusResult> {
  const env = await apiGet<BatchStatusResult>(`/api/actions/batch/${batchId}`, {
    ...(options.mailboxId ? { mailboxId: options.mailboxId } : {}),
  });
  return env.data;
}
