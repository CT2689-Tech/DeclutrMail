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
import { CurrentUser, JwtGuard } from '../auth/jwt.guard.js';
import { CapabilityGuard, RequiresCapability } from '../common/entitlements/capability.guard.js';
import { CurrentMailbox, CurrentMailboxGuard } from '../mailboxes/current-mailbox.guard.js';
import { RateLimit } from '../common/rate-limit/index.js';
import { UsersService } from '../users/users.service.js';
import { resolvePersistedBriefTodayLocal } from './brief-dates.js';
import { BriefReadService } from './brief.read-service.js';
import type { Brief, BriefMarkOpenedResult } from './brief.types.js';

@Controller('briefs')
@UseGuards(JwtGuard, CurrentMailboxGuard, CsrfGuard, CapabilityGuard)
@RequiresCapability('brief')
export class BriefController {
  constructor(
    private readonly reads: BriefReadService,
    private readonly users: UsersService,
  ) {}

  /**
   * GET /api/briefs/today — today's Brief for the caller's mailbox.
   * Returns 404 if the snapshot worker hasn't fired yet (FE refetches
   * after the cron tick).
   *
   * The day boundary comes from persisted `users.timezone`, exactly
   * like snapshot generation. A browser query param cannot select a
   * different Brief day. Missing or legacy-invalid stored zones fall
   * back to UTC, matching the generation worker.
   */
  @Get('today')
  @RateLimit('triage-load')
  async today(
    @CurrentUser() principal: { userId: string },
    @CurrentMailbox() mailbox: { id: string },
  ): Promise<Envelope<Brief>> {
    const accountId = mailbox.id;
    const user = await this.users.findById(principal.userId);
    const today = resolvePersistedBriefTodayLocal(new Date(), user?.timezone);
    const brief = await this.reads.getForDate(accountId, today, principal.userId);
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
    @CurrentUser() principal: { userId: string },
    @CurrentMailbox() mailbox: { id: string },
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
  ): Promise<Envelope<Brief[]>> {
    const accountId = mailbox.id;
    if (!from || !to) {
      throw new BadRequestException('from and to query params are required (YYYY-MM-DD).');
    }
    const briefs = await this.reads.listByRange(accountId, from, to, principal.userId);
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
