import {
  BadRequestException,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
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
import { UndoService } from './undo.service.js';
import type { UndoActionKind, UndoPayload, UndoResult } from './undo.types.js';

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
   * GET /api/undo — list active undo tokens for the current mailbox
   * (D35 persistent tray data source).
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
    }>
  > {
    const limit = clampLimit(rawLimit);
    const rows = await this.undo.listActive(mailbox.id, limit);
    const items = rows.map((row) => ({
      token: row.token,
      actionKind: row.actionKind,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
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
   * POST /api/undo/:token — revert the action recorded for `token`.
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
    if (!isUuid(token)) {
      throw new BadRequestException('token must be a UUID.');
    }
    const found = await this.undo.findRevertable(token, mailbox.id);
    if (found.outcome === 'not-found') {
      throw new HttpException(
        { error: { code: 'NOT_FOUND', message: 'Undo token not found.' } },
        HttpStatus.NOT_FOUND,
      );
    }
    if (found.outcome === 'expired') {
      // D58 — "Undo expired" path. The tooltip copy lives client-side
      // (D210); the server signals via HTTP 410.
      throw new HttpException(
        { error: { code: 'GONE', message: 'Undo window has expired.' } },
        HttpStatus.GONE,
      );
    }
    if (found.outcome === 'already-reverted') {
      // Recorded success — no new reverse job.
      return ok({
        token: found.entry.token,
        actionKind: found.entry.actionKind,
        reverted: true,
        expired: false,
        revertedAt: found.entry.revertedAt ? found.entry.revertedAt.toISOString() : null,
        actionId: null,
      });
    }

    // 'ready' — enqueue the reverse job for the verb's label change.
    // Only label-modify verbs have an async reverter today (archive).
    if (found.entry.actionKind !== 'archive') {
      throw new HttpException(
        {
          error: {
            code: 'UNSUPPORTED_UNDO',
            message: `Undo for "${found.entry.actionKind}" is not available yet.`,
          },
        },
        HttpStatus.NOT_IMPLEMENTED,
      );
    }
    const payload = found.entry.payload as UndoPayload;
    const messageIds = payload.kind === 'archive' ? payload.messageIds : [];
    const { actionId, status } = await this.actions.enqueueRevert({
      mailboxAccountId: mailbox.id,
      token,
      verb: 'archive',
      messageIds,
    });
    // A repeat POST may return an existing reverse row that already
    // completed — reflect that rather than always reporting in-flight
    // (the FE still polls `GET /api/actions/:actionId` for the truth).
    return ok({
      token,
      actionKind: found.entry.actionKind,
      reverted: status === 'done',
      expired: false,
      revertedAt: null,
      actionId,
    });
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

/** UUID v4 (relaxed — accepts any UUID per RFC 4122 hex layout). */
function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
