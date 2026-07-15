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
// TIER (D19/D83): the full Later review/reschedule surface is Pro. The
// small return-failure summary and Wake-now recovery are explicitly
// exempt: Later actions exist on every tier, so recovery cannot be an
// upsell. Successful returns remain silent.
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
  LaterReturnRecoverySummary,
  SnoozedSenderRow,
  SnoozeUpdateResult,
  WakeNowResult,
} from '@declutrmail/shared/contracts';

import { CsrfGuard } from '../auth/csrf.guard.js';
import { JwtGuard } from '../auth/jwt.guard.js';
import {
  CapabilityExempt,
  CapabilityGuard,
  RequiresCapability,
} from '../common/entitlements/capability.guard.js';
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
   * Safety recovery is never paywalled: every tier can use Later via
   * the action pipeline, so every tier must learn when a return is stuck.
   */
  @Get('recovery')
  @CapabilityExempt()
  @RateLimit('triage-load')
  async recovery(
    @CurrentMailbox() mailbox: { id: string },
  ): Promise<Envelope<LaterReturnRecoverySummary>> {
    return ok(await this.reads.recovery(mailbox.id));
  }

  /**
   * PATCH /api/snoozed/:senderId — set or extend the required future
   * wake time (`until: <ISO>`, D79/D82/D245). Moves no mail;
   * idempotent state diff. Wake now is the immediate-return path.
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

  /** All-tier retry, but only after the return is actually failed/missed. */
  @Post('recovery/:senderId/wake')
  @CapabilityExempt()
  @UseGuards(CsrfGuard)
  @RateLimit('gmail-action')
  async wakeRecovery(
    @CurrentMailbox() mailbox: { id: string },
    @Param('senderId') senderId: string,
  ): Promise<Envelope<WakeNowResult>> {
    if (!isUuid(senderId)) {
      throw new BadRequestException('Sender id must be a UUID.');
    }
    return ok(
      await this.snoozes.wakeRecovery({
        mailboxAccountId: mailbox.id,
        senderId,
      }),
    );
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
