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
  UndoActionKind,
  UnsubscribeLifecycleStatus,
  UnsubscribeManualTransition,
} from '@declutrmail/shared/contracts';
import { defaultLaterWakeAtIso } from '@declutrmail/shared/actions';
import type { ActionStatusSnapshot } from '@declutrmail/shared/actions';

import { apiGet, apiPost } from './client';

/** Lifecycle of an `action_jobs` row — mirrors the BE `ActionJobStatus`. */
export type { ActionJobStatus };

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

/** Returned by `GET /api/actions/:id` — canonical shared poll snapshot. */
export type ActionStatusResult = ActionStatusSnapshot;

/** Returned by `GET /api/actions/archive/preview` — the REAL inbox count. */
export interface ArchivePreviewResult {
  senderId: string;
  inboxCount: number;
}

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

/**
 * Enqueue an Archive of every inbox message from one sender. The worker
 * resolves the sender's current INBOX ids server-side (the `sender`
 * selector), so the client sends only the sender id.
 *
 * `override` is required to act on a Protected / VIP sender (D42).
 */
export async function enqueueArchiveSender(
  senderId: string,
  args: { idempotencyKey: string; override?: boolean } & ActionRequestOptions,
): Promise<ActionEnqueueResult> {
  const env = await apiPost<ActionEnqueueResult>(
    '/api/actions/archive',
    { selector: { type: 'sender', senderId }, override: args.override ?? false },
    {
      headers: { 'Idempotency-Key': args.idempotencyKey },
      ...(args.mailboxId ? { mailboxId: args.mailboxId } : {}),
    },
  );
  return env.data;
}

/**
 * Non-mutating preview: the REAL count of a sender's inbox mail (the exact
 * set the archive will move). Feeds the D226 confirm modal so it states
 * what actually changes, not an estimate. 404s an unowned sender.
 */
export async function getArchivePreview(
  senderId: string,
  options: ActionRequestOptions = {},
): Promise<ArchivePreviewResult> {
  const env = await apiGet<ArchivePreviewResult>('/api/actions/archive/preview', {
    query: { senderId },
    ...(options.mailboxId ? { mailboxId: options.mailboxId } : {}),
  });
  return env.data;
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
import type { CompositePrimaryVerb, CompositeSecondaryVerb } from '@declutrmail/shared/contracts';
export type { CompositePrimaryVerb, CompositeSecondaryVerb };
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

/** Returned by `GET /api/actions/preview` — composite preview shape. */
export interface CompositeActionPreviewResult {
  sender: {
    id: string;
    name: string;
    domain: string;
    lastSeenDays: number | null;
    /** `senders.replied_count` from mig 0022 — drives the
     *  sender-context-strip "you replied N×" copy. */
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
   * move" trust panel (spec v1.3). Each array is ordered by
   * `internal_date DESC`, capped at 5. Empty when no INBOX messages
   * match the window. `subject` is D7-allowlisted; no body, no
   * attachment, no header-outside-allowlist surfaces here.
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
 * Enqueue a unified composite action (ADR-0020). Single-verb shape omits
 * `secondary`; composite shape includes it. The BE handles both through
 * one path so the FE can talk to ONE endpoint regardless of selection.
 */
export async function enqueueCompositeAction(
  input: {
    senderId: string;
    primary: { type: CompositePrimaryVerb; olderThanDays?: number | null; wakeAt?: string };
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
   *   - `none`      → no unsubscribe channel; archive is the fallback.
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
export const UNSUB_AMBIGUOUS_ERROR_CODE = 'UNSUB_AMBIGUOUS_REDIRECT';

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
  options: ActionRequestOptions & { idempotencyKey?: string } = {},
): Promise<UnsubscribeIntentResult> {
  const idempotencyKey = options.idempotencyKey ?? newIdempotencyKey();
  const env = await apiPost<UnsubscribeIntentResult>(
    '/api/actions/unsubscribe-intent',
    { senderId },
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
  return env.data;
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
 * shows AGGREGATED impact). `totals` excludes Protected/VIP senders
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
  skipped: Array<{ senderId: string; reason: 'protected' | 'not_found' }>;
}

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
