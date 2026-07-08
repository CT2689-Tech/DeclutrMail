// apps/api/src/briefs/brief.controller.ts — HTTP surface for the Brief
// Pro feature (D61, D69).
//
// Thin per D201/D204: validates input, delegates to `BriefReadService`,
// wraps the result in the D202 envelope.
//
// AUTH (D155 + D205): `JwtGuard` + `CurrentMailboxGuard` + `CsrfGuard`.
//
// TIER (D19): the Brief is a Pro capability — every route 402s
// `PRO_FEATURE_REQUIRED` for under-tier workspaces via
// `CapabilityGuard` (the FE TierGate on /brief never fetches
// pre-upgrade; this is the server half of that gate).

import {
  BadRequestException,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { type Envelope, ok } from '@declutrmail/shared/contracts';

import { CsrfGuard } from '../auth/csrf.guard.js';
import { JwtGuard } from '../auth/jwt.guard.js';
import { CapabilityGuard, RequiresCapability } from '../common/entitlements/capability.guard.js';
import { CurrentMailbox, CurrentMailboxGuard } from '../mailboxes/current-mailbox.guard.js';
import { RateLimit } from '../common/rate-limit/index.js';
import { resolveBriefTodayLocal } from './brief-dates.js';
import { BriefReadService } from './brief.read-service.js';
import type { Brief, BriefMarkOpenedResult } from './brief.types.js';

@Controller('briefs')
@UseGuards(JwtGuard, CurrentMailboxGuard, CsrfGuard, CapabilityGuard)
@RequiresCapability('brief')
export class BriefController {
  constructor(private readonly reads: BriefReadService) {}

  /**
   * GET /api/briefs/today?tz=<IANA> — today's Brief for the caller's
   * mailbox. Returns 404 if the snapshot worker hasn't fired yet (FE
   * refetches after the cron tick).
   *
   * `tz` (optional) is the caller's IANA timezone — the server resolves
   * "today" in that zone so the Brief day boundary is the USER's
   * midnight, not UTC's (D64 read-path half). Absent `tz` → UTC date,
   * the original contract (backward compatible). Invalid `tz` → 400
   * INVALID_TIMEZONE.
   */
  @Get('today')
  @RateLimit('triage-load')
  async today(
    @CurrentMailbox() mailbox: { id: string },
    @Query('tz') tz: string | undefined,
  ): Promise<Envelope<Brief>> {
    const accountId = mailbox.id;
    const today = resolveBriefTodayLocal(new Date(), tz);
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
    @CurrentMailbox() mailbox: { id: string },
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
  ): Promise<Envelope<Brief[]>> {
    const accountId = mailbox.id;
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
    @CurrentMailbox() mailbox: { id: string },
    @Param('id') id: string,
  ): Promise<Envelope<BriefMarkOpenedResult>> {
    const accountId = mailbox.id;
    if (!isUuid(id)) {
      throw new BadRequestException('Brief id must be a UUID.');
    }
    const result = await this.reads.markOpened(accountId, id);
    if (!result) {
      throw notFound('Brief not found.');
    }
    return ok(result);
  }
}

function notFound(message: string): HttpException {
  return new HttpException({ message }, HttpStatus.NOT_FOUND);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
