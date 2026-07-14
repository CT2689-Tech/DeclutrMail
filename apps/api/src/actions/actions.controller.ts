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
  bulkPreviewRequestSchema,
  compositeActionRequestSchema,
  keepIntentRequestSchema,
  unsubscribeIntentRequestSchema,
  unsubscribeManualStatusRequestSchema,
  type ActionEnqueueResult,
  type ActionStatusResult,
  type ArchivePreviewResult,
  type BatchStatusResult,
  type BulkActionEnqueueResult,
  type BulkActionPreviewResult,
  type CompositeActionEnqueueResult,
  type CompositeActionPreviewResult,
  type KeepIntentResult,
  type UnsubscribeIntentResult,
  type UnsubscribeManualStatusResult,
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
   *   - 409 PROTECTED_SENDER (sender is Protected, `override:false`)
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
  ): Promise<Envelope<CompositeActionEnqueueResult | BulkActionEnqueueResult>> {
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
    // D52 multi-sender bulk — same endpoint per ADR-0020 ("Bulk variant").
    // Fans out server-side; the response is the batch handle the FE polls
    // at GET /api/actions/batch/:batchId. The bulk surface has no
    // Protected-override affordance, so no `override` is threaded.
    if (req.selector.type === 'senders') {
      const result = await this.actions.enqueueBulkComposite({
        mailboxAccountId: mailbox.id,
        senderIds: req.selector.senderIds,
        primary: {
          type: req.primary.type,
          olderThanDays: req.primary.olderThanDays ?? null,
          wakeAt: req.primary.wakeAt ? new Date(req.primary.wakeAt) : null,
        },
        secondary: req.secondary
          ? { type: req.secondary.type, olderThanDays: req.secondary.olderThanDays ?? null }
          : undefined,
        idempotencyKey: idempotencyKey.trim(),
      });
      return ok(result);
    }
    const result = await this.actions.enqueueComposite({
      mailboxAccountId: mailbox.id,
      selector: req.selector,
      primary: {
        type: req.primary.type,
        olderThanDays: req.primary.olderThanDays ?? null,
        wakeAt: req.primary.wakeAt ? new Date(req.primary.wakeAt) : null,
      },
      secondary: req.secondary
        ? { type: req.secondary.type, olderThanDays: req.secondary.olderThanDays ?? null }
        : undefined,
      idempotencyKey: idempotencyKey.trim(),
      override: req.override ?? false,
    });
    return ok(result);
  }

  /**
   * POST /api/actions/unsubscribe-intent — record the user's intent to
   * unsubscribe from a sender (D38 + 2026-06-05 founder brainstorm).
   *
   * Unlike Archive/Delete/Later, this does not enqueue a Gmail label
   * mutation. It records the decision, then routes by capability:
   *
   *   1. one_click → requested + an RFC 8058 execution job.
   *   2. mailto → action_required; the client opens compose and reports
   *      explicit progress through the manual-status route.
   *   3. none → unavailable. All paths append truthful Activity rows.
   *
   * Idempotency (D202). Requires `Idempotency-Key` header (≥8 chars)
   * matching the sibling routes. A network-retried POST with the same
   * key returns the prior result without writing a second audit row;
   * a fresh user click (new key) writes a new audit row — that's the
   * "each click is a decision" semantic, kept honest via the key.
   * Added 2026-06-05 after architecture-guardian flagged the prior
   * "no idempotency at all" stance as an invitation for phantom audit
   * rows from flaky-network retries.
   */
  @RateLimit({ bucket: 'gmail-action' })
  @Post('unsubscribe-intent')
  @UseGuards(CsrfGuard)
  async unsubscribeIntent(
    @CurrentMailbox() mailbox: { id: string },
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): Promise<Envelope<UnsubscribeIntentResult>> {
    if (!idempotencyKey || idempotencyKey.trim().length < 8) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'An Idempotency-Key header (≥8 chars) is required for actions.',
      });
    }
    const parsed = unsubscribeIntentRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: parsed.error.issues[0]?.message ?? 'Invalid unsubscribe-intent request.',
      });
    }
    const result = await this.actions.recordUnsubscribeIntent({
      mailboxAccountId: mailbox.id,
      senderId: parsed.data.senderId,
      idempotencyKey: idempotencyKey.trim(),
    });
    return ok(result);
  }

  /**
   * POST /api/actions/unsubscribe-manual-status — explicitly record
   * progress on a mailto unsubscribe. The client calls draft_opened
   * immediately before opening compose and user_marked_sent only after
   * an explicit user confirmation. Neither state claims delivery.
   */
  @RateLimit({ bucket: 'gmail-action' })
  @Post('unsubscribe-manual-status')
  @UseGuards(CsrfGuard)
  async unsubscribeManualStatus(
    @CurrentMailbox() mailbox: { id: string },
    @Body() body: unknown,
  ): Promise<Envelope<UnsubscribeManualStatusResult>> {
    const parsed = unsubscribeManualStatusRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: parsed.error.issues[0]?.message ?? 'Invalid manual unsubscribe status request.',
      });
    }
    const result = await this.actions.recordUnsubscribeManualStatus({
      mailboxAccountId: mailbox.id,
      senderId: parsed.data.senderId,
      status: parsed.data.status,
    });
    return ok(result);
  }

  /**
   * POST /api/actions/keep-intent — record the user's Keep verdict for
   * a sender (D40 + the D226 Triage wiring).
   *
   * Keep is policy/verdict-only (Action Registry: `policy-only`): the
   * service writes the 0-affected `activity_log` decision row and
   * emits the `triage.verdict_applied` outbox event whose consumer
   * projects `sender_policies.policy_type='keep'`. No Gmail mutation,
   * no worker job, no undo token.
   *
   * Idempotency: semantic — a Keep on a sender that already has a
   * Keep decision inside the D30 decided window replays the original
   * row (see `ActionsService.recordKeepIntent`). No `Idempotency-Key`
   * header is required: the dedup key is the decision itself, and the
   * sibling routes' action_jobs dedup-row trick is unavailable
   * (`action_verb` pg_enum has no 'keep') and unnecessary here.
   */
  @RateLimit({ bucket: 'gmail-action' })
  @Post('keep-intent')
  @UseGuards(CsrfGuard)
  async keepIntent(
    @CurrentMailbox() mailbox: { id: string },
    @Body() body: unknown,
  ): Promise<Envelope<KeepIntentResult>> {
    const parsed = keepIntentRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: parsed.error.issues[0]?.message ?? 'Invalid keep-intent request.',
      });
    }
    const result = await this.actions.recordKeepIntent({
      mailboxAccountId: mailbox.id,
      senderId: parsed.data.senderId,
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
   * POST /api/actions/preview/bulk — aggregated multi-sender preview
   * (D52 + ADR-0020 "Bulk variant"). POST because a 1,000-sender
   * selection does not fit a query string; the call is READ-ONLY
   * (no mutation, no enqueue). CsrfGuard kept so every POST under
   * /actions carries the double-submit token uniformly.
   */
  @RateLimit({ bucket: 'triage-load', limit: 120, windowSec: 60 })
  @Post('preview/bulk')
  @UseGuards(CsrfGuard)
  async bulkPreview(
    @CurrentMailbox() mailbox: { id: string },
    @Body() body: unknown,
  ): Promise<Envelope<BulkActionPreviewResult>> {
    const parsed = bulkPreviewRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: parsed.error.issues[0]?.message ?? 'Invalid bulk preview request.',
      });
    }
    const result = await this.actions.previewBulkComposite({
      mailboxAccountId: mailbox.id,
      senderIds: parsed.data.senderIds,
    });
    return ok(result);
  }

  /**
   * GET /api/actions/batch/:id — aggregate status for a multi-sender
   * batch (D52). One poll covers every sibling row (anchor +
   * `composite_id` children) instead of N per-row polls. Same poll
   * rate-limit as the per-row status route. Mailbox-scoped → 404 if
   * not owned. Declared before `:id` so the two-segment path is
   * unambiguous.
   */
  @RateLimit({ bucket: 'triage-load', limit: 120, windowSec: 60 })
  @Get('batch/:id')
  async batchStatus(
    @CurrentMailbox() mailbox: { id: string },
    @Param('id') id: string,
  ): Promise<Envelope<BatchStatusResult>> {
    if (!isUuid(id)) {
      throw new BadRequestException({ code: 'INVALID_ID', message: 'id must be a UUID.' });
    }
    const result = await this.actions.getBatchStatus(id, mailbox.id);
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
