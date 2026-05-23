import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';

import { UndoService } from './undo.service.js';
import type { UndoActionKind, UndoResult } from './undo.types.js';

/**
 * UndoController — `/undo` endpoints (D35, D58).
 *
 * Auth note (PR-B onwards): the D109/D224 session layer has not landed.
 * Until it does, the mailbox is identified by the `x-mailbox-account-id`
 * header (matches the test-rig pattern used by the OAuth callback's
 * `mailboxAccountId` return). Once the session layer ships, the header
 * is replaced by a guard reading the JWT and rejecting requests that
 * touch a token outside the authenticated mailbox.
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
export class UndoController {
  constructor(private readonly undo: UndoService) {}

  /**
   * GET /api/undo — list active undo tokens for the current mailbox
   * (D35 persistent tray data source).
   */
  @Get()
  async listActive(
    @Headers('x-mailbox-account-id') mailboxAccountId: string | undefined,
    @Query('limit') rawLimit: string | undefined,
  ): Promise<{
    data: Array<{
      token: string;
      actionKind: UndoActionKind;
      createdAt: string;
      expiresAt: string;
    }>;
    meta: { pagination: { nextCursor: null; hasMore: false; limit: number } };
  }> {
    const accountId = this.requireMailbox(mailboxAccountId);
    const limit = clampLimit(rawLimit);
    const rows = await this.undo.listActive(accountId, limit);
    return {
      data: rows.map((row) => ({
        token: row.token,
        actionKind: row.actionKind,
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
      })),
      // The tray is single-page by design (see controller header). The
      // envelope still carries `pagination` so the D202 contract
      // shape is uniform with cursor-paginated endpoints — clients
      // never have to special-case undo.
      meta: { pagination: { nextCursor: null, hasMore: false, limit } },
    };
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
  @Post(':token')
  async revert(
    @Headers('x-mailbox-account-id') mailboxAccountId: string | undefined,
    @Param('token') token: string,
  ): Promise<{ data: UndoResult; meta: Record<string, never> }> {
    const accountId = this.requireMailbox(mailboxAccountId);
    if (!isUuid(token)) {
      throw new BadRequestException('token must be a UUID.');
    }
    const claim = await this.undo.claimForRevert(token, accountId);
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
      return {
        data: toResult(claim.entry),
        meta: {},
      };
    }
    // claim.outcome === 'claimed' — we own the revert. The per-verb
    // reverter dispatch lands with each destructive feature slice; the
    // immediate `recordRevertSuccess` here closes the loop for the
    // journal-only PR. Once a reverter is wired, it runs between
    // `claimForRevert` and `recordRevertSuccess`; a failure rethrows
    // BEFORE `recordRevertSuccess` so reverted_at stays null and a
    // retry re-claims the work.
    const stamped = await this.undo.recordRevertSuccess(token);
    return {
      data: toResult(stamped),
      meta: {},
    };
  }

  /** Reject requests with no mailbox header — pre-auth-layer minimum. */
  private requireMailbox(headerValue: string | undefined): string {
    if (!headerValue || !isUuid(headerValue)) {
      throw new BadRequestException('x-mailbox-account-id header is required.');
    }
    return headerValue;
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
