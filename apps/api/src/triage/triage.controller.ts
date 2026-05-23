import { BadRequestException, Body, Controller, Post } from '@nestjs/common';

import { TriageService } from './triage.service.js';

/**
 * Triage routes (D20, D25) — minimal at PR-D20 scope.
 *
 *   POST /api/triage/score-sender
 *     { mailboxAccountId, senderKey } → { data: { idempotencyKey } }
 *     Enqueues a re-score for one (mailbox, sender). 202-style ack —
 *     the worker writes `triage_decisions` asynchronously.
 *
 * Per D204 the controller is thin — it only validates input and
 * delegates to `TriageService`. No business logic here.
 *
 * No auth at this PR's scope: the D109/D224 auth layer hasn't landed,
 * so the controller takes the `mailboxAccountId` from the body for now.
 * The auth-aware version will resolve it from session — flagged in the
 * PR body as a follow-up.
 *
 * D7 / D228: read-only over metadata. No body content touched.
 */
@Controller('triage')
export class TriageController {
  constructor(private readonly triage: TriageService) {}

  @Post('score-sender')
  async scoreSender(
    @Body() body: { mailboxAccountId?: unknown; senderKey?: unknown },
  ): Promise<{ data: { idempotencyKey: string } }> {
    const mailboxAccountId =
      typeof body?.mailboxAccountId === 'string' ? body.mailboxAccountId : null;
    const senderKey = typeof body?.senderKey === 'string' ? body.senderKey : null;
    if (!mailboxAccountId || !senderKey) {
      throw new BadRequestException('mailboxAccountId and senderKey are required string fields.');
    }
    const result = await this.triage.scoreSender({ mailboxAccountId, senderKey });
    return { data: result };
  }
}
