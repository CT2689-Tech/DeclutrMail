import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ok, type Envelope } from '@declutrmail/shared/contracts';

import { CsrfGuard } from '../auth/csrf.guard.js';
import { JwtGuard } from '../auth/jwt.guard.js';
import { IconsService } from '../icons/icons.service.js';
import { CurrentMailbox, CurrentMailboxGuard } from '../mailboxes/current-mailbox.guard.js';
import { RateLimit } from '../common/rate-limit/index.js';
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
// A3: Triage is Free — the class-level `triage` capability gate came
// off per D245 (prelaunch — no vestigial gating).
@Controller('triage')
@UseGuards(JwtGuard, CurrentMailboxGuard, CsrfGuard)
export class TriageController {
  /** Per D30, queue size is clamped to `[5, 12]`. */
  private static readonly QUEUE_HARD_MAX = 12;

  constructor(
    private readonly triage: TriageService,
    private readonly reads: TriageReadService,
    private readonly icons: IconsService,
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
    @Body() body: { senderKey?: unknown; senderId?: unknown; reason?: unknown },
  ): Promise<Envelope<{ idempotencyKey: string }>> {
    // `senderId` is the shape a page has: the senders wire carries the
    // row id, never the `sender_key` hash. Resolving it here keeps the
    // key server-side instead of publishing it so the FE can hand it
    // back, and the mailbox-scoped lookup means a guessed id 404s
    // rather than enqueueing work against another mailbox.
    const senderId = typeof body?.senderId === 'string' ? body.senderId : null;
    const senderKey = senderId
      ? await this.triage.resolveSenderKey(mailbox.id, senderId)
      : typeof body?.senderKey === 'string'
        ? body.senderKey
        : null;
    if (senderId && !senderKey) {
      throw notFound('Sender not found.');
    }
    if (!senderKey) {
      throw new BadRequestException('senderKey or senderId is required.');
    }
    // Unknown values fail closed to `user` rather than 400: the reason is
    // telemetry, and a typo in it is no reason to refuse a re-score.
    const reason = body?.reason === 'stale' ? 'stale' : 'user';
    const result = await this.triage.scoreSender({
      mailboxAccountId: mailbox.id,
      senderKey,
      reason,
    });
    return ok(result);
  }

  @Get('queue-size')
  async queueSize(
    @CurrentMailbox() mailbox: { id: string },
  ): Promise<Envelope<{ targetSize: number }>> {
    const targetSize = await this.triage.getQueueSize(mailbox.id);
    return ok({ targetSize });
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
    const marks = await this.brandMarksFor(rows.map((row) => row.senderDomain));
    return ok(rows.map((row) => ({ ...row, brandMark: marks.has(row.senderDomain) })));
  }

  /**
   * Batched brand-mark availability for one queue page (ADR-0034),
   * mirroring `SendersController.brandMarksFor`.
   *
   * Triage is the coldest cache in the product: it is the daily ritual and
   * often a new user's first real screen, so the domains on it are the
   * ones least likely to have been resolved yet. Without this, every row's
   * `Avatar` fires an `/api/icons/:domain` request and each unresolved
   * domain costs a full round trip to be answered 204. One batched read
   * replaces all of them.
   *
   * A FAILURE HERE MUST NOT FAIL THE QUEUE. Availability is decoration —
   * a cache read that throws degrades to the monogram, which ADR-0034
   * defines as the floor rather than a fallback, identical to a 204 or the
   * flag being off. Logged, never swallowed silently.
   */
  private async brandMarksFor(domains: string[]): Promise<Set<string>> {
    try {
      return await this.icons.marksFor(domains, { mayEnqueue: true });
    } catch (err) {
      console.error(
        JSON.stringify({
          level: 'error',
          kind: 'triage.brand_marks_failed',
          count: domains.length,
          message: err instanceof Error ? err.message : String(err),
        }),
      );
      return new Set();
    }
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

/**
 * NOT_FOUND with the D202 error code on the envelope — same helper the
 * senders / followups / autopilot controllers carry.
 */
function notFound(message: string): HttpException {
  return new HttpException({ message }, HttpStatus.NOT_FOUND);
}
