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

import { CsrfGuard } from '../auth/csrf.guard.js';
import { JwtGuard } from '../auth/jwt.guard.js';
import { CurrentMailbox, CurrentMailboxGuard } from '../mailboxes/current-mailbox.guard.js';
import { RateLimit } from '../common/rate-limit/index.js';
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
  constructor(private readonly undo: UndoService) {}

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
   * Idempotent: second call returns the same `UndoResult` without
   * re-executing the revert.
   *
   * NOTE: this PR ships the journal lifecycle + idempotent claim. The
   * per-verb reverters (archive-reverter, unsubscribe-reverter, etc.)
   * land with each destructive feature slice; this handler claims the
   * token and immediately records success because the per-verb revert
   * surface is empty at this point. When a reverter lands, it will be
   * injected and the line marked below replaces the immediate success.
   * This is documented in the PR body so the founder can audit the
   * staging order.
   */
  /**
   * Rate-limit (D156): `gmail-action` bucket with a per-route override
   * of 30/min = 0.5/sec. Undo is rare; the slow refill caps abuse of
   * the destructive revert surface well below any reasonable human
   * pace while still permitting a rapid burst from a confused user.
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
    const claim = await this.undo.claimForRevert(token, mailbox.id);
    if (claim.outcome === 'not-found') {
      throw new HttpException(
        { error: { code: 'NOT_FOUND', message: 'Undo token not found.' } },
        HttpStatus.NOT_FOUND,
      );
    }
    if (claim.outcome === 'expired') {
      // D58 — "Undo expired" path. The tooltip copy lives client-side
      // (D210); the server signals via HTTP 410.
      throw new HttpException(
        { error: { code: 'GONE', message: 'Undo window has expired.' } },
        HttpStatus.GONE,
      );
    }
    if (claim.outcome === 'already-reverted') {
      return ok(toResult(claim.entry));
    }
    // claim.outcome === 'claimed' — we own the revert. The per-verb
    // reverter dispatch lands with each destructive feature slice; the
    // immediate `recordRevertSuccess` here closes the loop for the
    // journal-only PR. Once a reverter is wired, it runs between
    // `claimForRevert` and `recordRevertSuccess`; a failure rethrows
    // BEFORE `recordRevertSuccess` so reverted_at stays null and a
    // retry re-claims the work.
    const stamped = await this.undo.recordRevertSuccess(token);
    return ok(toResult(stamped));
  }
}

/**
 * Format a journal row as the API result. `revertedAt` is always set
 * here because every code path that calls this is after a successful
 * (or already-recorded) revert.
 */
function toResult(row: {
  token: string;
  actionKind: UndoActionKind;
  revertedAt: Date | null;
}): UndoResult {
  return {
    token: row.token,
    actionKind: row.actionKind,
    reverted: row.revertedAt !== null,
    expired: false,
    revertedAt: row.revertedAt ? row.revertedAt.toISOString() : null,
  };
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
