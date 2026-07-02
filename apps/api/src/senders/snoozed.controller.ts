// apps/api/src/senders/snoozed.controller.ts — HTTP surface for the
// Snoozed/Later review screen (D78–D80, D82).
//
// Thin per D201/D204: validates input, delegates to
// `SnoozedReadService` / `SnoozeService`, wraps results in the D202
// envelope. Lives in the senders feature because both services operate
// on senders-owned tables (`sender_policies`, `senders`).
//
// AUTH (D155 + D205): `JwtGuard` + `CurrentMailboxGuard` on every
// route; the state-changing PATCH/POST additionally require
// `CsrfGuard` (double-submit cookie) — matching `PATCH
// /api/senders/:id/policy`.
//
// TIER (D19/D83): the Snoozed review surface is a Pro capability —
// every route 402s `PRO_FEATURE_REQUIRED` for under-tier workspaces
// via `CapabilityGuard`. The Later VERB itself stays on every tier
// (it rides the action pipeline + the D19 free cleanup quota); only
// this review/manage surface is Pro.
//
// PRIVACY (D7, D228): list rows carry sender display metadata, counts,
// and timestamps only. Never fetches from Gmail (the worker owns the
// Gmail boundary); never returns message content.

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { type Envelope, ok, SnoozeUpdateRequestSchema } from '@declutrmail/shared/contracts';
import type {
  SnoozedSenderRow,
  SnoozeUpdateResult,
  WakeNowResult,
} from '@declutrmail/shared/contracts';

import { CsrfGuard } from '../auth/csrf.guard.js';
import { JwtGuard } from '../auth/jwt.guard.js';
import { CapabilityGuard, RequiresCapability } from '../common/entitlements/capability.guard.js';
import { CurrentMailbox, CurrentMailboxGuard } from '../mailboxes/current-mailbox.guard.js';
import { RateLimit } from '../common/rate-limit/index.js';
import { SnoozeService } from './snooze.service.js';
import { SnoozedReadService } from './snoozed.read-service.js';

@Controller('snoozed')
@UseGuards(JwtGuard, CurrentMailboxGuard, CapabilityGuard)
@RequiresCapability('snoozed')
export class SnoozedController {
  constructor(
    private readonly reads: SnoozedReadService,
    private readonly snoozes: SnoozeService,
  ) {}

  /**
   * GET /api/snoozed — every sender currently in the Later bucket
   * (mirror membership ∪ active timer), soonest wake first. Bounded by
   * the size of the user's Later'd sender set — no pagination at
   * launch (D80 renders grouped sections, not an infinite list).
   */
  @Get()
  @RateLimit('triage-load')
  async list(@CurrentMailbox() mailbox: { id: string }): Promise<Envelope<SnoozedSenderRow[]>> {
    return ok(await this.reads.list(mailbox.id));
  }

  /**
   * PATCH /api/snoozed/:senderId — set / extend (`until: <ISO>`) or
   * cancel (`until: null`) the sender's wake timer (D79, D82). Moves
   * no mail; idempotent state diff.
   */
  @Patch(':senderId')
  @UseGuards(CsrfGuard)
  @RateLimit('triage-load')
  async patchSnooze(
    @CurrentMailbox() mailbox: { id: string },
    @Param('senderId') senderId: string,
    @Body() body: unknown,
  ): Promise<Envelope<SnoozeUpdateResult>> {
    if (!isUuid(senderId)) {
      throw new BadRequestException('Sender id must be a UUID.');
    }
    const parsed = SnoozeUpdateRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: parsed.error.issues[0]?.message ?? 'Invalid snooze update.',
      });
    }
    const result = await this.snoozes.setSnooze({
      mailboxAccountId: mailbox.id,
      senderId,
      until: parsed.data.until,
      reason: parsed.data.reason,
    });
    return ok(result);
  }

  /**
   * POST /api/snoozed/:senderId/wake — D80 "Wake now". Enqueues the
   * restore for the snooze-wake worker (Gmail label restore + mirror +
   * timer clear) and returns `queued`; the FE refetches the list until
   * the row drops off. Rate-limited on the Gmail-action bucket — each
   * wake spends Gmail mutation quota.
   */
  @Post(':senderId/wake')
  @UseGuards(CsrfGuard)
  @RateLimit('gmail-action')
  async wakeNow(
    @CurrentMailbox() mailbox: { id: string },
    @Param('senderId') senderId: string,
  ): Promise<Envelope<WakeNowResult>> {
    if (!isUuid(senderId)) {
      throw new BadRequestException('Sender id must be a UUID.');
    }
    const result = await this.snoozes.wakeNow({
      mailboxAccountId: mailbox.id,
      senderId,
    });
    return ok(result);
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
