import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ok, type Envelope } from '@declutrmail/shared/contracts';

import { CsrfGuard } from '../auth/csrf.guard.js';
import { JwtGuard } from '../auth/jwt.guard.js';
import { CurrentMailbox, CurrentMailboxGuard } from '../mailboxes/current-mailbox.guard.js';
import { RateLimit } from '../common/rate-limit/index.js';
import { ActionsService } from './actions.service.js';
import {
  archiveRequestSchema,
  compositeActionRequestSchema,
  type ActionEnqueueResult,
  type ActionStatusResult,
  type ArchivePreviewResult,
  type CompositeActionEnqueueResult,
  type CompositeActionPreviewResult,
} from './actions.types.js';

/**
 * ActionsController — the async destructive-action pipeline API (D226).
 *
 * Auth (D155 + D205): `JwtGuard` + `CurrentMailboxGuard` (active mailbox
 * → `@CurrentMailbox()`). The state-changing POST additionally requires
 * `CsrfGuard` (double-submit cookie), matching the undo mutation route.
 *
 * Lifecycle: the POST resolves + enqueues and returns immediately with an
 * `actionId` + `queued` status (the mutation runs in the worker — D226
 * intent → … → mutation → undo). The FE polls `GET /api/actions/:id`
 * until `done` (then reads the `undoToken`) or `failed`.
 *
 * Idempotency (D202): the `Idempotency-Key` header is the dedup key — one
 * per user click. A network-retried click returns the same action; a
 * fresh click is a new action (re-archiving a sender next week is NOT the
 * same action). Thin per-verb routes (archive now; trash later) delegate
 * to the verb-agnostic `ActionsService`.
 */
@Controller('actions')
@UseGuards(JwtGuard, CurrentMailboxGuard)
export class ActionsController {
  constructor(private readonly actions: ActionsService) {}

  /**
   * POST /api/actions/archive — resolve the target set, enqueue, return
   * the action handle. Rate-limit (D156): `gmail-action` bucket (caps
   * destructive-action API abuse; per-user Gmail quota is governed
   * separately in the worker's `RateLimiter`).
   */
  @RateLimit({ bucket: 'gmail-action' })
  @Post('archive')
  @UseGuards(CsrfGuard)
  async archive(
    @CurrentMailbox() mailbox: { id: string },
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): Promise<Envelope<ActionEnqueueResult>> {
    if (!idempotencyKey || idempotencyKey.trim().length < 8) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'An Idempotency-Key header (≥8 chars) is required for actions.',
      });
    }
    const parsed = archiveRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: parsed.error.issues[0]?.message ?? 'Invalid action request.',
      });
    }
    const result = await this.actions.enqueueArchive({
      mailboxAccountId: mailbox.id,
      selector: parsed.data.selector,
      idempotencyKey: idempotencyKey.trim(),
      override: parsed.data.override ?? false,
    });
    return ok(result);
  }

  /**
   * GET /api/actions/archive/preview?senderId= — the REAL current-inbox
   * count for a sender, for the D226 confirm modal (so the preview states
   * what will actually move, never a client estimate). Read-only → no
   * CsrfGuard. Mailbox-scoped → 404 if the sender isn't in the active
   * mailbox. Declared before `:id` so the two-segment path is unambiguous.
   */
  @RateLimit({ bucket: 'triage-load', limit: 120, windowSec: 60 })
  @Get('archive/preview')
  async archivePreview(
    @CurrentMailbox() mailbox: { id: string },
    @Query('senderId') senderId: string | undefined,
  ): Promise<Envelope<ArchivePreviewResult>> {
    if (!senderId || !isUuid(senderId)) {
      throw new BadRequestException({ code: 'INVALID_ID', message: 'senderId must be a UUID.' });
    }
    const result = await this.actions.previewArchive({ mailboxAccountId: mailbox.id, senderId });
    return ok(result);
  }

  /**
   * POST /api/actions — unified composite action endpoint per ADR-0020.
   *
   * Request body: `CompositeActionRequest` (selector + primary verb +
   * optional secondary historic verb + optional time-window filter).
   * Single-verb action (e.g. just Archive) omits `secondary` and yields
   * ONE `action_jobs` row (`composite_id = NULL`). A composite (e.g.
   * Unsub + Delete past) yields TWO linked rows (`composite_id` on the
   * secondary references the primary's `id`).
   *
   * Rate-limit (D156): same `gmail-action` bucket as per-verb routes.
   * Auth: JwtGuard + CurrentMailboxGuard + CsrfGuard (state-changing).
   *
   * Phase 1 BE scope: this controller validates the wire shape +
   * delegates the supported primary-only Archive case to the existing
   * `enqueueArchive` service path so the FE can migrate from
   * `/api/actions/archive` to `/api/actions` without behavior change.
   * Delete + secondary + composite cascade-undo wiring lands in
   * Phase 1 BE PR-N — until then the controller 501s with a clear
   * code so the FE can fall back to per-verb endpoints.
   */
  @RateLimit({ bucket: 'gmail-action' })
  @Post()
  @UseGuards(CsrfGuard)
  async composite(
    @CurrentMailbox() mailbox: { id: string },
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): Promise<Envelope<CompositeActionEnqueueResult>> {
    if (!idempotencyKey || idempotencyKey.trim().length < 8) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'An Idempotency-Key header (≥8 chars) is required for actions.',
      });
    }
    const parsed = compositeActionRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: parsed.error.issues[0]?.message ?? 'Invalid composite action request.',
      });
    }
    const req = parsed.data;

    // Phase 1 BE scope guard: only single-verb Archive primary delegates
    // to existing service path today. Other primaries + composites land
    // as the service-layer composite executor wires up.
    if (req.primary.type === 'archive' && req.secondary === undefined) {
      const result = await this.actions.enqueueArchive({
        mailboxAccountId: mailbox.id,
        selector: req.selector,
        idempotencyKey: idempotencyKey.trim(),
        override: req.override ?? false,
      });
      // Map ActionEnqueueResult → CompositeActionEnqueueResult shape.
      // composite_id = actionId for single-verb rows (NULL at DB level
      // but the wire return mirrors the parent-id convention so the FE
      // can carry the composite_id through cascade-undo uniformly).
      return ok({
        actionId: result.actionId,
        compositeId: result.actionId,
        secondaryId: null,
        status: result.status,
        primaryCount: result.requestedCount,
        secondaryCount: null,
      });
    }

    // Delete / later primary + any composite secondary: Phase 1 BE PR-N
    // wires the executor. 501 surfaces a clean fallback signal so the
    // FE can route to per-verb endpoints during the transition.
    throw new HttpException(
      {
        code: 'COMPOSITE_NOT_IMPLEMENTED',
        message:
          'Composite shape not yet implemented at this BE phase — FE should fall back to per-verb endpoint.',
        verb: req.primary.type,
        hasSecondary: req.secondary !== undefined,
      },
      HttpStatus.NOT_IMPLEMENTED,
    );
  }

  /**
   * GET /api/actions/preview — composite preview per ADR-0020.
   *
   * Returns the sender context strip (used by ConfirmActionModal's
   * "Acting on {sender}" header) + counts per time-window bucket
   * (30d / 90d / 180d / 365d) for the chip row. Read-only → no
   * CsrfGuard. Mailbox-scoped → 404 if the sender isn't owned.
   *
   * Phase 1 BE scope: today this delegates the un-windowed `all` count
   * to the existing `previewArchive` service path and stubs the
   * per-bucket counts to zero so the controller wire shape is
   * stable. Phase 1 BE PR-N wires the per-bucket counts via the new
   * `SELECT count(*) FILTER (WHERE internal_date <= …)` query.
   */
  @RateLimit({ bucket: 'triage-load', limit: 120, windowSec: 60 })
  @Get('preview')
  async compositePreview(
    @CurrentMailbox() mailbox: { id: string },
    @Query('senderId') senderId: string | undefined,
  ): Promise<Envelope<CompositeActionPreviewResult>> {
    if (!senderId || !isUuid(senderId)) {
      throw new BadRequestException({ code: 'INVALID_ID', message: 'senderId must be a UUID.' });
    }
    const archive = await this.actions.previewArchive({
      mailboxAccountId: mailbox.id,
      senderId,
    });
    return ok({
      sender: {
        id: archive.senderId,
        name: '',
        domain: '',
        lastSeenDays: null,
        repliedCount: null,
        monthly: null,
      },
      counts: {
        all: archive.inboxCount,
        // Per-bucket counts wired in Phase 1 BE PR-N — stubbed equal
        // to `all` here so the FE chip row defaults to "All inbox"
        // visibility cleanly until the per-bucket query lands.
        olderThan30d: archive.inboxCount,
        olderThan90d: archive.inboxCount,
        olderThan180d: archive.inboxCount,
        olderThan365d: archive.inboxCount,
      },
      unsubAvailable: false,
      protected: false,
    });
  }

  /**
   * GET /api/actions/:id — poll an action's status. Rate-limit (D156):
   * `triage-load` bucket overridden to 120/min — a slow bulk archive is
   * polled every 1–2s until `done`, which would exhaust the 30/min
   * default mid-poll. Mailbox-scoped → 404 if not owned.
   */
  @RateLimit({ bucket: 'triage-load', limit: 120, windowSec: 60 })
  @Get(':id')
  async status(
    @CurrentMailbox() mailbox: { id: string },
    @Param('id') id: string,
  ): Promise<Envelope<ActionStatusResult>> {
    if (!isUuid(id)) {
      throw new BadRequestException({ code: 'INVALID_ID', message: 'id must be a UUID.' });
    }
    const result = await this.actions.getStatus(id, mailbox.id);
    return ok(result);
  }
}

/** UUID v4 (relaxed — accepts any RFC 4122 hex layout). */
function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
