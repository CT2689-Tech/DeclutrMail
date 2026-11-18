import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  ok,
  paginated,
  type Envelope,
  type PaginatedEnvelope,
} from '@declutrmail/shared/contracts';

import { ActionsService } from '../actions/actions.service.js';
import { CsrfGuard } from '../auth/csrf.guard.js';
import { JwtGuard } from '../auth/jwt.guard.js';
import { CurrentMailbox, CurrentMailboxGuard } from '../mailboxes/current-mailbox.guard.js';
import { RateLimit } from '../common/rate-limit/index.js';
import { revertDecision } from './revert-decision.js';
import { UndoService } from './undo.service.js';
import type { UndoActionKind, UndoResult } from './undo.types.js';

/**
 * UndoController — `/undo` endpoints (D35, D58).
 *
 * Auth (D155 + D205): `JwtGuard` populates `req.user`,
 * `CurrentMailboxGuard` resolves the active mailbox into
 * `@CurrentMailbox()`. State-changing `POST :token` also requires
 * `CsrfGuard` (double-submit cookie).
 *
 * Response shape: D202 envelope (`{ data, meta }`). Pagination is
 * inline-list — the active tray fits comfortably in a single page (see
 * `UndoService.listActive` for the limit cap). Cursor pagination would
 * be over-engineering at the tray's UX scale; a future migration to
 * cursor is straightforward should we hit the cap.
 *
 * Idempotency: the URL token IS the idempotency key (architecture-
 * guardian Check H). A second POST returns the same result without
 * re-running the revert — `UndoService.claimForRevert` enforces this
 * with an atomic UPDATE on `executed_at`. This satisfies D202's
 * "mutation endpoints accept Idempotency-Key" rule via the route
 * parameter rather than a header.
 */
@Controller('undo')
@UseGuards(JwtGuard, CurrentMailboxGuard)
export class UndoController {
  constructor(
    private readonly undo: UndoService,
    private readonly actions: ActionsService,
  ) {}

  /**
   * GET /api/undo — the current mailbox's undoable DECISIONS, newest
   * first (D35 persistent tray data source).
   *
   * One item per decision, not per token: a bulk action over N senders
   * issues N tokens, and listing those printed N identical lines whose
   * Undo each reversed the whole batch (founder report 2026-09-20). See
   * `UndoService.listActiveDecisions`.
   *
   * Wire: ADDITIVE. `token` / `actionKind` / `createdAt` / `expiresAt`
   * keep their meaning (`token` reverts the whole decision, exactly as
   * every listed token already did), so a web bundle predating the new
   * fields renders one generic line per decision. A newer bundle against
   * an older API sees the fields absent and renders as it always did.
   *
   * Rate-limit (D156): `triage-load` bucket with a per-route override
   * of 300/min = 5/sec. The tray re-fetches after every undo POST + on
   * page load; 5/sec absorbs both bursts without throttling normal use.
   */
  @RateLimit({ bucket: 'triage-load', limit: 300, windowSec: 60 })
  @Get()
  async listActive(
    @CurrentMailbox() mailbox: { id: string },
    @Query('limit') rawLimit: string | undefined,
  ): Promise<
    PaginatedEnvelope<{
      token: string;
      actionKind: UndoActionKind;
      createdAt: string;
      expiresAt: string;
      groupId: string;
      senderCount: number;
      memberCount: number;
      affectedCount: number | null;
      mixedKinds: boolean;
      protectedSkippedCount: number;
      members: Array<{
        token: string;
        actionKind: UndoActionKind;
        senderName: string | null;
        affectedCount: number;
      }>;
    }>
  > {
    const limit = clampLimit(rawLimit);
    const decisions = await this.undo.listActiveDecisions(mailbox.id, limit);
    const items = decisions.map((d) => ({
      token: d.token,
      actionKind: d.actionKind,
      createdAt: d.createdAt.toISOString(),
      expiresAt: d.expiresAt.toISOString(),
      groupId: d.groupId,
      senderCount: d.senderCount,
      memberCount: d.memberCount,
      affectedCount: d.affectedCount,
      mixedKinds: d.mixedKinds,
      protectedSkippedCount: d.protectedSkippedCount,
      members: d.members,
    }));
    // The tray is single-page by design (see controller header). We
    // still emit through `paginated()` with a `null` next-cursor so the
    // D202 envelope shape stays uniform with cursor-paginated routes
    // (`hasMore` is derived from `nextCursor !== null`, so single-page
    // semantics fall out automatically) — clients never have to
    // special-case undo.
    return paginated({ items, limit, nextCursor: null });
  }

  /**
   * POST /api/undo/:token — revert the original composite/batch.
   * Activity uses /:token/action to reverse only the displayed action.
   *
   * Async (D226): the forward action ran in a worker, so the revert does
   * too. This validates the token, then enqueues a reverse `action_jobs`
   * row and returns its `actionId` + `status:'queued'`; the FE polls
   * `GET /api/actions/:actionId` for `done`. Idempotency is the reverse
   * row's `revert:<token>` key + the BullMQ `jobId` + the worker's
   * `reverted_at IS NULL` guard — NOT the old `claimForRevert`
   * `executed_at` lock (which stranded tokens whose async revert failed).
   *
   * A second POST while the revert is in flight returns the SAME reverse
   * `actionId` (idempotent). A POST after it completed returns
   * `reverted:true` without enqueueing.
   *
   * Rate-limit (D156): `gmail-action` bucket, 30/min — the slow refill
   * caps abuse of the destructive revert surface while permitting a
   * confused user's rapid burst.
   */
  @RateLimit({ bucket: 'gmail-action', limit: 30, windowSec: 60 })
  @Post(':token')
  @UseGuards(CsrfGuard)
  async revert(
    @CurrentMailbox() mailbox: { id: string },
    @Param('token') token: string,
  ): Promise<Envelope<UndoResult>> {
    return this.performRevert(mailbox, token);
  }

  /** A separate route fails closed if web deploys before the supporting API. */
  @RateLimit({ bucket: 'gmail-action', limit: 30, windowSec: 60 })
  @Post(':token/action')
  @UseGuards(CsrfGuard)
  async revertAction(
    @CurrentMailbox() mailbox: { id: string },
    @Param('token') token: string,
  ): Promise<Envelope<UndoResult>> {
    return this.performRevert(mailbox, token, 'action');
  }

  private async performRevert(
    mailbox: { id: string },
    token: string,
    scope?: 'action',
  ): Promise<Envelope<UndoResult>> {
    return ok(
      await revertDecision({ undo: this.undo, actions: this.actions }, mailbox.id, token, scope),
    );
  }
}

/** Clamp the requested limit to the server-side max for the tray. */
function clampLimit(raw: string | undefined): number {
  const DEFAULT = 50;
  const MAX = 100;
  if (!raw) return DEFAULT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT;
  return Math.min(parsed, MAX);
}
