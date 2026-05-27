import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ok, type Envelope } from '@declutrmail/shared/contracts';

import { RateLimit } from '../common/rate-limit/index.js';
import { TriageService } from './triage.service.js';

/**
 * Triage routes (D20, D25, D30) — minimal at PR-D20/D30 scope.
 *
 *   POST /api/triage/score-sender
 *     { mailboxAccountId, senderKey } → { data: { idempotencyKey } }
 *     Enqueues a re-score for one (mailbox, sender). 202-style ack —
 *     the worker writes `triage_decisions` asynchronously.
 *
 *   GET  /api/triage/queue-size?mailboxAccountId=…
 *     → { data: { targetSize: number } }
 *     D30 adaptive queue size in `[5, 12]`. The FE asks for this
 *     before fetching rows so it never over-fetches.
 *
 * Per D204 the controller is thin — it only validates input and
 * delegates to `TriageService`. No business logic here.
 *
 * No auth at this PR's scope: the D109/D224 auth layer hasn't landed,
 * so the controller takes the `mailboxAccountId` from the request for
 * now. The auth-aware version will resolve it from session — flagged
 * in the PR body as a follow-up.
 *
 * D7 / D228: read-only over metadata. No body content touched.
 */
@Controller('triage')
export class TriageController {
  constructor(private readonly triage: TriageService) {}

  /**
   * Rate-limit (D156): `gmail-action` bucket — score-sender enqueues a
   * worker job that may touch Gmail metadata. 60/min default matches
   * one new sender/sec, which is far above any plausible human pace.
   */
  @RateLimit('gmail-action')
  @Post('score-sender')
  async scoreSender(
    @Body() body: { mailboxAccountId?: unknown; senderKey?: unknown },
  ): Promise<Envelope<{ idempotencyKey: string }>> {
    const mailboxAccountId =
      typeof body?.mailboxAccountId === 'string' ? body.mailboxAccountId : null;
    const senderKey = typeof body?.senderKey === 'string' ? body.senderKey : null;
    if (!mailboxAccountId || !senderKey) {
      throw new BadRequestException('mailboxAccountId and senderKey are required string fields.');
    }
    const result = await this.triage.scoreSender({ mailboxAccountId, senderKey });
    return ok(result);
  }

  @Get('queue-size')
  async queueSize(
    @Query('mailboxAccountId') mailboxAccountId: string | undefined,
  ): Promise<{ data: { targetSize: number } }> {
    if (typeof mailboxAccountId !== 'string' || mailboxAccountId.length === 0) {
      throw new BadRequestException('mailboxAccountId query parameter is required.');
    }
    const targetSize = await this.triage.getQueueSize(mailboxAccountId);
    return { data: { targetSize } };
  }
}
