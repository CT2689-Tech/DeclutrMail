import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
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
   * Later + Delete past) yields TWO linked rows — primary's
   * `composite_id` stays NULL (self-implicit via `id`); secondary's
   * `composite_id` references the primary's id. The cascade-undo path
   * (`POST /api/undo/:token`) walks `composite_id` to reverse siblings.
   *
   * Rate-limit (D156): same `gmail-action` bucket as per-verb routes.
   * Auth: JwtGuard + CurrentMailboxGuard + CsrfGuard (state-changing).
   *
   * Errors:
   *   - 400 INVALID_REQUEST / IDEMPOTENCY_KEY_REQUIRED
   *   - 404 SENDER_NOT_FOUND (sender selector, ownership mismatch)
   *   - 409 PROTECTED_SENDER (sender is Protected/VIP, `override:false`)
   *   - 409 IDEMPOTENCY_KEY_CONFLICT (key reused across mailboxes)
   *   - 503 QUEUE_UNAVAILABLE (REDIS_URL unset)
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
    const result = await this.actions.enqueueComposite({
      mailboxAccountId: mailbox.id,
      selector: req.selector,
      primary: { type: req.primary.type, olderThanDays: req.primary.olderThanDays ?? null },
      secondary: req.secondary
        ? { type: req.secondary.type, olderThanDays: req.secondary.olderThanDays ?? null }
        : undefined,
      idempotencyKey: idempotencyKey.trim(),
      override: req.override ?? false,
    });
    return ok(result);
  }

  /**
   * GET /api/actions/preview — composite preview per ADR-0020.
   *
   * Returns the sender context strip (used by ConfirmActionModal's
   * "Acting on {sender}" header) + counts per time-window bucket
   * (30d / 90d / 180d / 365d) for the chip row. One aggregate query in
   * the service computes all four buckets + the un-windowed `all` + the
   * monthly figure for the context strip, so the modal opens in a single
   * round-trip. Read-only → no CsrfGuard. Mailbox-scoped → 404 if the
   * sender isn't owned.
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
    const result = await this.actions.previewComposite({
      mailboxAccountId: mailbox.id,
      senderId,
    });
    return ok(result);
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
