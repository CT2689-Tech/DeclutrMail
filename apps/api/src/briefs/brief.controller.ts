// apps/api/src/briefs/brief.controller.ts — HTTP surface for the Brief
// Pro feature (D61, D69).
//
// Thin per D201/D204: validates input, delegates to `BriefReadService`,
// wraps the result in the D202 envelope.
//
// AUTH NOTE (until D109/D224 lands): mailbox identified by
// `x-mailbox-account-id` header — same pattern as Senders, Autopilot,
// Followups, Undo controllers. When the session layer lands, the
// header gets replaced by a guard reading the JWT.

import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { type Envelope, ok } from '@declutrmail/shared/contracts';

import { RateLimit } from '../common/rate-limit/index.js';
import { BriefReadService } from './brief.read-service.js';
import type { Brief, BriefMarkOpenedResult } from './brief.types.js';

@Controller('briefs')
export class BriefController {
  constructor(private readonly reads: BriefReadService) {}

  /**
   * GET /api/briefs/today — today's Brief for the caller's mailbox.
   * Returns 404 if the snapshot worker hasn't fired yet (FE refetches
   * after the cron tick).
   *
   * V2 simplification: today = UTC date. When `users.timezone` lands
   * the controller derives the local-date from the user record.
   */
  @Get('today')
  @RateLimit('triage-load')
  async today(
    @Headers('x-mailbox-account-id') mailboxAccountId: string | undefined,
  ): Promise<Envelope<Brief>> {
    const accountId = this.requireMailbox(mailboxAccountId);
    const today = new Date().toISOString().slice(0, 10);
    const brief = await this.reads.getForDate(accountId, today);
    if (!brief) {
      throw notFound('Brief not found for today.');
    }
    return ok(brief);
  }

  /**
   * GET /api/briefs?from=YYYY-MM-DD&to=YYYY-MM-DD — historical Brief
   * list in a date range, newest first.
   */
  @Get()
  @RateLimit('triage-load')
  async list(
    @Headers('x-mailbox-account-id') mailboxAccountId: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
  ): Promise<Envelope<Brief[]>> {
    const accountId = this.requireMailbox(mailboxAccountId);
    if (!from || !to) {
      throw new BadRequestException('from and to query params are required (YYYY-MM-DD).');
    }
    const briefs = await this.reads.listByRange(accountId, from, to);
    return ok(briefs);
  }

  /**
   * POST /api/briefs/:id/mark-opened — D61 first-view tracker. Sets
   * `opened_at` on the first call; second call returns the existing
   * timestamp. Cross-tenant / unknown id → 404.
   */
  @Post(':id/mark-opened')
  @RateLimit('triage-load')
  async markOpened(
    @Headers('x-mailbox-account-id') mailboxAccountId: string | undefined,
    @Param('id') id: string,
  ): Promise<Envelope<BriefMarkOpenedResult>> {
    const accountId = this.requireMailbox(mailboxAccountId);
    if (!isUuid(id)) {
      throw new BadRequestException('Brief id must be a UUID.');
    }
    const result = await this.reads.markOpened(accountId, id);
    if (!result) {
      throw notFound('Brief not found.');
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
