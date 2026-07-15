import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ok, type Envelope } from '@declutrmail/shared/contracts';

import { CsrfGuard } from '../auth/csrf.guard.js';
import { JwtGuard } from '../auth/jwt.guard.js';
import { CurrentMailbox, CurrentMailboxGuard } from '../mailboxes/current-mailbox.guard.js';
import { RateLimit } from '../common/rate-limit/index.js';
import { ScreenerReadService } from './screener.read-service.js';
import { ScreenerService } from './screener.service.js';
import {
  screenerDecideRequestSchema,
  type ScreenerCountResult,
  type ScreenerDecideResult,
  type ScreenerQueueRow,
} from './screener.types.js';

/**
 * Screener routes (D71–D77).
 *
 *   GET  /api/screener/queue?limit=…  → ScreenerQueueRow[]
 *   GET  /api/screener/count          → { pending }   (D74 badge poll)
 *   POST /api/screener/decide         → ScreenerDecideResult
 *
 * Per D204 thin — input validation + delegation only. Auth (D155 +
 * D205): `JwtGuard` + `CurrentMailboxGuard`; the state-changing POST
 * additionally requires `CsrfGuard` (double-submit cookie).
 *
 * D77 — every route is gated on the workspace's `screener` capability
 * (Pro+); Free/Plus get 402 `PRO_FEATURE_REQUIRED` so the FE branches
 * to the upgrade surface instead of an empty queue.
 *
 * D7 / D228: reads are metadata-only. The decide POST mutates Gmail
 * ONLY via the existing action pipeline (D226 lifecycle intact).
 */
@Controller('screener')
@UseGuards(JwtGuard, CurrentMailboxGuard)
export class ScreenerController {
  /** Queue page ceiling — the Screener is a review queue, not an inventory. */
  private static readonly QUEUE_HARD_MAX = 100;
  private static readonly QUEUE_DEFAULT = 50;

  constructor(
    private readonly reads: ScreenerReadService,
    private readonly screener: ScreenerService,
  ) {}

  @Get('queue')
  @RateLimit('triage-load')
  async queue(
    @CurrentMailbox() mailbox: { id: string },
    @Query('limit') rawLimit: string | undefined,
  ): Promise<Envelope<ScreenerQueueRow[]>> {
    await this.screener.assertScreenerCapability(mailbox.id);
    const requested = rawLimit ? Number.parseInt(rawLimit, 10) : ScreenerController.QUEUE_DEFAULT;
    const limit =
      Number.isFinite(requested) && requested > 0
        ? Math.min(requested, ScreenerController.QUEUE_HARD_MAX)
        : ScreenerController.QUEUE_DEFAULT;
    const rows = await this.reads.listQueue({ mailboxAccountId: mailbox.id, limit });
    return ok(rows);
  }

  /**
   * Badge count (D74). Polled by the sidebar hook — same elevated
   * poll budget as the action-status route (the default 30/min would
   * starve a tab that also loads the queue).
   */
  @Get('count')
  @RateLimit({ bucket: 'triage-load', limit: 120, windowSec: 60 })
  async count(@CurrentMailbox() mailbox: { id: string }): Promise<Envelope<ScreenerCountResult>> {
    await this.screener.assertScreenerCapability(mailbox.id);
    const result = await this.reads.pendingCount(mailbox.id);
    return ok(result);
  }

  /**
   * Decide a queued sender (K/A/U/L/D). Requires an `Idempotency-Key`
   * header (≥8 chars, one per user click) — threaded into the
   * delegated pipeline so a network-retried POST replays instead of
   * double-acting (D202).
   */
  @RateLimit({ bucket: 'gmail-action' })
  @Post('decide')
  @UseGuards(CsrfGuard)
  async decide(
    @CurrentMailbox() mailbox: { id: string },
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): Promise<Envelope<ScreenerDecideResult>> {
    await this.screener.assertScreenerCapability(mailbox.id);
    if (!idempotencyKey || idempotencyKey.trim().length < 8) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'An Idempotency-Key header (≥8 chars) is required for decisions.',
      });
    }
    const parsed = screenerDecideRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: parsed.error.issues[0]?.message ?? 'Invalid decide request.',
      });
    }
    const result = await this.screener.decide({
      mailboxAccountId: mailbox.id,
      senderId: parsed.data.senderId,
      verb: parsed.data.verb,
      olderThanDays: parsed.data.olderThanDays ?? null,
      wakeAt: parsed.data.wakeAt ? new Date(parsed.data.wakeAt) : null,
      idempotencyKey: idempotencyKey.trim(),
    });
    return ok(result);
  }
}
