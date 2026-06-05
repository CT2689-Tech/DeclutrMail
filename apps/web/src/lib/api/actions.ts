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

import { apiGet, apiPost } from './client';

/** Lifecycle of an `action_jobs` row — mirrors the BE `ActionJobStatus`. */
export type ActionJobStatus = 'queued' | 'executing' | 'done' | 'failed';

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

/** Returned by `GET /api/actions/:id` — the polled action state. */
export interface ActionStatusResult {
  actionId: string;
  status: ActionJobStatus;
  requestedCount: number;
  affectedCount: number;
  /** Present once `status === 'done'` for a reversible verb; else null. */
  undoToken: string | null;
  errorCode: string | null;
}

/** Returned by `GET /api/actions/archive/preview` — the REAL inbox count. */
export interface ArchivePreviewResult {
  senderId: string;
  inboxCount: number;
}

/** Returned by `POST /api/undo/:token` — the reverse handle to poll. */
export interface UndoRevertResult {
  token: string;
  actionKind: string;
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
export type CompositePrimaryVerb = 'archive' | 'later' | 'delete';
/** Secondary historic verb — applies on Unsubscribe / Later primaries. */
export type CompositeSecondaryVerb = 'archive' | 'delete';

/** Returned by `POST /api/actions` — composite enqueue handle. */
export interface CompositeActionEnqueueResult {
  actionId: string;
  compositeId: string;
  secondaryId: string | null;
  status: ActionJobStatus;
  primaryCount: number;
  secondaryCount: number | null;
}

/** Returned by `GET /api/actions/preview` — composite preview shape. */
export interface CompositeActionPreviewResult {
  sender: {
    id: string;
    name: string;
    domain: string;
    lastSeenDays: number | null;
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
    primary: { type: CompositePrimaryVerb; olderThanDays?: number | null };
    secondary?: { type: CompositeSecondaryVerb; olderThanDays?: number | null };
    override?: boolean;
    idempotencyKey: string;
  } & ActionRequestOptions,
): Promise<CompositeActionEnqueueResult> {
  const env = await apiPost<CompositeActionEnqueueResult>(
    '/api/actions',
    {
      selector: { type: 'sender', senderId: input.senderId },
      primary: input.primary,
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
