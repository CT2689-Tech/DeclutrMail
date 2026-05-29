import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
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
  type ActionEnqueueResult,
  type ActionStatusResult,
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
