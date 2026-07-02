// apps/api/src/followups/followup.controller.ts — HTTP surface for the
// Followups Pro feature (D84-D91).
//
// Thin per D201/D204: validates input, delegates to
// `FollowupReadService`, wraps the result in the D202 envelope.
//
// AUTH (D155 + D205): `JwtGuard` + `CurrentMailboxGuard` + `CsrfGuard`.
//
// TIER (D19/D89): Followups is a Pro capability — every route 402s
// `PRO_FEATURE_REQUIRED` for under-tier workspaces via
// `CapabilityGuard` (the FE TierGate on /followups never fetches
// pre-upgrade; this is the server half of that gate).

import {
  BadRequestException,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { type Envelope, ok } from '@declutrmail/shared/contracts';

import { CsrfGuard } from '../auth/csrf.guard.js';
import { JwtGuard } from '../auth/jwt.guard.js';
import { CapabilityGuard, RequiresCapability } from '../common/entitlements/capability.guard.js';
import { CurrentMailbox, CurrentMailboxGuard } from '../mailboxes/current-mailbox.guard.js';
import { RateLimit } from '../common/rate-limit/index.js';
import { FollowupReadService } from './followup.read-service.js';
import type { Followup, FollowupDismissResult } from './followup.types.js';

@Controller('followups')
@UseGuards(JwtGuard, CurrentMailboxGuard, CsrfGuard, CapabilityGuard)
@RequiresCapability('followups')
export class FollowupController {
  constructor(private readonly reads: FollowupReadService) {}

  /**
   * GET /api/followups — list awaiting followups for the caller's
   * mailbox, newest first. Returns the D85 priority bucket computed
   * from `sentAt` against the request clock.
   */
  @Get()
  @RateLimit('triage-load')
  async list(@CurrentMailbox() mailbox: { id: string }): Promise<Envelope<Followup[]>> {
    const followups = await this.reads.listAwaiting(mailbox.id);
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
    @CurrentMailbox() mailbox: { id: string },
    @Param('id') id: string,
  ): Promise<Envelope<FollowupDismissResult>> {
    if (!isUuid(id)) {
      throw new BadRequestException('Followup id must be a UUID.');
    }
    const result = await this.reads.dismiss(mailbox.id, id);
    if (!result) {
      throw notFound('Followup not found.');
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
