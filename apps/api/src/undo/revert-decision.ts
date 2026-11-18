import {
  BadRequestException,
  GoneException,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';

import type { ActionsService } from '../actions/actions.service.js';
import type { UndoService } from './undo.service.js';
import type { UndoActionKind, UndoResult } from './undo.types.js';

/**
 * Revert one undoable decision (D58). The single implementation behind
 * `POST /api/undo/:token` and the connector's `undo` tool (ADR-0048: the
 * connector calls what the web app calls), so the two cannot drift.
 *
 * Throws the route's own HTTP exceptions: 400 for a malformed token, 404
 * `NOT_FOUND`, 410 `GONE` once the window closed, 501 `UNSUPPORTED_UNDO`
 * for a kind with no reverter.
 */
export async function revertDecision(
  deps: { undo: UndoService; actions: ActionsService },
  mailboxAccountId: string,
  token: string,
  scope?: 'action',
): Promise<UndoResult> {
  if (!isUuid(token)) {
    throw new BadRequestException('token must be a UUID.');
  }
  const found = await deps.undo.findRevertable(token, mailboxAccountId);
  if (found.outcome === 'not-found') {
    // Top-level { code, message }, NOT { error: { … } }. The filter
    // owns the envelope: it reads `code` and `message` off the
    // exception body, so pre-wrapping made BOTH extractions miss and
    // Nest's `initMessage()` fallback shipped the literal string
    // "Http Exception" to the user as their error message
    // (audit 2026-08-21).
    throw new NotFoundException({ code: 'NOT_FOUND', message: 'Undo token not found.' });
  }
  if (found.outcome === 'expired') {
    // D58 — "Undo expired" path. The tooltip copy lives client-side
    // (D210); the server signals via HTTP 410.
    throw new GoneException({ code: 'GONE', message: 'Undo window has expired.' });
  }
  if (
    found.outcome === 'already-reverted' &&
    (scope === 'action' ||
      !(await deps.actions.hasUnrevertedCompositeSiblings(token, mailboxAccountId)))
  ) {
    // Recorded success — no new reverse job.
    return {
      token: found.entry.token,
      actionKind: found.entry.actionKind,
      reverted: true,
      expired: false,
      revertedAt: found.entry.revertedAt ? found.entry.revertedAt.toISOString() : null,
      actionId: null,
      actionIds: [],
    };
  }

  // 'ready' — enqueue the reverse job(s) for the verb's label change.
  // Composite-aware (ADR-0020): `enqueueCompositeRevert` resolves the
  // primary + any secondaries via `action_jobs.composite_id` and fires
  // a reverse row for each in primary-first order. For a single-verb
  // action this returns just the one row.
  //
  // Only the label-modify family has an async reverter today
  // (archive / later / delete). Unsubscribe + apply-rule keep their
  // 501 fail-closed signal until their reverter pipelines land.
  if (!LABEL_MODIFY_UNDO_KINDS.has(found.entry.actionKind)) {
    throw new NotImplementedException({
      code: 'UNSUPPORTED_UNDO',
      message: `Undo for "${found.entry.actionKind}" is not available yet.`,
    });
  }

  const reverts = await deps.actions.enqueueCompositeRevert({
    mailboxAccountId,
    token,
    ...(scope === 'action' ? { scope: 'action' as const } : {}),
  });
  // Retain the first handle for rolling web/API deploys. Current clients
  // poll the whole frozen set in one read; the first job cannot confirm
  // restoration of its siblings.
  const primary = reverts[0];
  const allDone = reverts.length > 0 && reverts.every((r) => r.status === 'done');
  const completed = allDone
    ? await deps.actions.getUndoStatus(
        reverts.map((revert) => revert.actionId),
        mailboxAccountId,
      )
    : null;
  return {
    token,
    actionKind: found.entry.actionKind,
    reverted: allDone,
    expired: false,
    revertedAt: completed?.undoRevertedAt ?? null,
    actionId: primary?.actionId ?? null,
    actionIds: reverts.map((revert) => revert.actionId),
  };
}

/**
 * Undo kinds whose reverter pipeline is wired end-to-end (label-modify
 * family). `unsubscribe` and `apply-rule` are reserved for their own
 * pipeline PRs and return 501 until then.
 */
const LABEL_MODIFY_UNDO_KINDS: ReadonlySet<UndoActionKind> = new Set<UndoActionKind>([
  'archive',
  'later',
  'delete',
]);

/** UUID v4 (relaxed — accepts any UUID per RFC 4122 hex layout). */
function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
