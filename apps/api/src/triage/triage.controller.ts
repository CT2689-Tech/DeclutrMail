import { BadRequestException, Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ok, type Envelope } from '@declutrmail/shared/contracts';

import { CsrfGuard } from '../auth/csrf.guard.js';
import { JwtGuard } from '../auth/jwt.guard.js';
import { CurrentMailbox, CurrentMailboxGuard } from '../mailboxes/current-mailbox.guard.js';
import { RateLimit } from '../common/rate-limit/index.js';
import { CapabilityGuard, RequiresCapability } from '../common/entitlements/capability.guard.js';
import {
  TriageReadService,
  type TodaySummary,
  type TriageQueueRow,
  type TriageSessionStats,
} from './triage.read-service.js';
import { TriageService } from './triage.service.js';

/**
 * Triage routes (D20, D25, D29, D30, D33).
 *
 *   POST /api/triage/score-sender   { senderKey } → idempotencyKey
 *   GET  /api/triage/queue-size                    → adaptive D30 size
 *   GET  /api/triage/queue?limit=…                 → TriageQueueRow[]
 *   GET  /api/triage/stats                         → TriageSessionStats
 *   GET  /api/triage/today-summary                 → TodaySummary (D214)
 *
 * Per D204 thin — only input validation + delegation. Auth (D155 +
 * D205): `JwtGuard` + `CurrentMailboxGuard` + `CsrfGuard`.
 *
 * D7 / D228: read-only over metadata. No body content touched.
 */
@Controller('triage')
@UseGuards(JwtGuard, CurrentMailboxGuard, CsrfGuard, CapabilityGuard)
@RequiresCapability('triage')
export class TriageController {
  /** Per D30, queue size is clamped to `[5, 12]`. */
  private static readonly QUEUE_HARD_MAX = 12;

  constructor(
    private readonly triage: TriageService,
    private readonly reads: TriageReadService,
  ) {}

  /**
   * Rate-limit (D156): `gmail-action` bucket — score-sender enqueues a
   * worker job that may touch Gmail metadata. 60/min default matches
   * one new sender/sec, which is far above any plausible human pace.
   */
  @RateLimit('gmail-action')
  @Post('score-sender')
  async scoreSender(
    @CurrentMailbox() mailbox: { id: string },
    @Body() body: { senderKey?: unknown },
  ): Promise<Envelope<{ idempotencyKey: string }>> {
    const senderKey = typeof body?.senderKey === 'string' ? body.senderKey : null;
    if (!senderKey) {
      throw new BadRequestException('senderKey is required.');
    }
    const result = await this.triage.scoreSender({
      mailboxAccountId: mailbox.id,
      senderKey,
    });
    return ok(result);
  }

  @Get('queue-size')
  async queueSize(
    @CurrentMailbox() mailbox: { id: string },
  ): Promise<{ data: { targetSize: number } }> {
    const targetSize = await this.triage.getQueueSize(mailbox.id);
    return { data: { targetSize } };
  }

  /**
   * GET /api/triage/queue — the daily ritual's row payload.
   *
   * The client should first hit `/queue-size` to pick the right limit;
   * passing a larger `?limit=` clamps to `QUEUE_HARD_MAX` so the
   * cohort stays in the daily-ritual band even on misuse.
   */
  @Get('queue')
  @RateLimit('triage-load')
  async queue(
    @CurrentMailbox() mailbox: { id: string },
    @Query('limit') rawLimit: string | undefined,
  ): Promise<Envelope<TriageQueueRow[]>> {
    const requested = rawLimit ? Number.parseInt(rawLimit, 10) : TriageController.QUEUE_HARD_MAX;
    const limit =
      Number.isFinite(requested) && requested > 0
        ? Math.min(requested, TriageController.QUEUE_HARD_MAX)
        : TriageController.QUEUE_HARD_MAX;
    const rows = await this.reads.listQueue({
      mailboxAccountId: mailbox.id,
      limit,
    });
    return ok(rows);
  }

  @Get('stats')
  @RateLimit('triage-load')
  async stats(@CurrentMailbox() mailbox: { id: string }): Promise<Envelope<TriageSessionStats>> {
    const stats = await this.reads.getSessionStats({ mailboxAccountId: mailbox.id });
    return ok(stats);
  }

  /** D214 — the "Today" strip atop Triage (counts over metadata only). */
  @Get('today-summary')
  @RateLimit('triage-load')
  async todaySummary(@CurrentMailbox() mailbox: { id: string }): Promise<Envelope<TodaySummary>> {
    const summary = await this.reads.getTodaySummary({ mailboxAccountId: mailbox.id });
    return ok(summary);
  }
}
