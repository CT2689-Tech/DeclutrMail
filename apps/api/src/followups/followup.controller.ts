// apps/api/src/followups/followup.controller.ts — HTTP surface for the
// Followups Pro feature (D84-D91).
//
// Thin per D201/D204: validates input, delegates to
// `FollowupReadService`, wraps the result in the D202 envelope.
//
// AUTH NOTE (until D109/D224): mailbox identified by
// `x-mailbox-account-id` header — same pattern as SendersController,
// AutopilotController, UndoController. When the session layer lands,
// the header gets replaced by a guard reading the JWT.

import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { type Envelope, ok } from '@declutrmail/shared/contracts';

import { RateLimit } from '../common/rate-limit/index.js';
import { FollowupReadService } from './followup.read-service.js';
import type { Followup, FollowupDismissResult } from './followup.types.js';

@Controller('followups')
export class FollowupController {
  constructor(private readonly reads: FollowupReadService) {}

  /**
   * GET /api/followups — list awaiting followups for the caller's
   * mailbox, newest first. Returns the D85 priority bucket computed
   * from `sentAt` against the request clock.
   */
  @Get()
  @RateLimit('triage-load')
  async list(
    @Headers('x-mailbox-account-id') mailboxAccountId: string | undefined,
  ): Promise<Envelope<Followup[]>> {
    const accountId = this.requireMailbox(mailboxAccountId);
    const followups = await this.reads.listAwaiting(accountId);
    return ok(followups);
  }

  /**
   * POST /api/followups/:id/dismiss — D88 "Mark resolved".
   *
   * Idempotency (D202/D207, Phase 1): a repeat dismiss of the same
   * (mailbox, id) returns 200 with `alreadyDismissed: true` instead of
   * a 404, so a flaky-network retry can render the success state.
   * Cross-tenant lookups + non-awaiting rows still collapse to 404 so
   * caller cannot probe existence across mailboxes.
   */
  @Post(':id/dismiss')
  @RateLimit('triage-load')
  async dismiss(
    @Headers('x-mailbox-account-id') mailboxAccountId: string | undefined,
    @Param('id') id: string,
  ): Promise<Envelope<FollowupDismissResult>> {
    const accountId = this.requireMailbox(mailboxAccountId);
    if (!isUuid(id)) {
      throw new BadRequestException('Followup id must be a UUID.');
    }
    const result = await this.reads.dismiss(accountId, id);
    if (!result) {
      throw notFound('Followup not found.');
    }
    return ok(result);
  }

  private requireMailbox(headerValue: string | undefined): string {
    if (!headerValue || !isUuid(headerValue)) {
      throw new BadRequestException('x-mailbox-account-id header is required.');
    }
    return headerValue;
  }
}

function notFound(message: string): HttpException {
  return new HttpException({ message }, HttpStatus.NOT_FOUND);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
