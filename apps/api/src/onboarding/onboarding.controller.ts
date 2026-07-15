// apps/api/src/onboarding/onboarding.controller.ts — HTTP surface for
// the onboarding step machine (D106-D113).
//
// Thin per D201/D204: validates input via the shared Zod contracts,
// delegates to `OnboardingService`, wraps results in the D202
// envelope.
//
// AUTH (D155): every route requires a session (`JwtGuard`) — the
// PRE-AUTH steps (promise + connect, D107/D108) are static web
// surfaces and never call this controller. The two mailbox-scoped
// reads/writes additionally resolve the active mailbox
// (`CurrentMailboxGuard`); state + complete are user-scoped on purpose
// so a fresh signup with zero mailboxes can still read its flow state.
//
// PRIVACY (D7, D228): flow metadata only — timestamps, preset keys,
// and the already-audited triage queue projection. No body content.

import { BadRequestException, Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import {
  OnboardingCompleteRequestSchema,
  OnboardingPresetPicksRequestSchema,
  withMeta,
  ok,
  type Envelope,
  type OnboardingFirstTriageMeta,
  type OnboardingPresetPicksResult,
  type OnboardingState,
} from '@declutrmail/shared/contracts';

import { CsrfGuard } from '../auth/csrf.guard.js';
import { CurrentUser, JwtGuard } from '../auth/jwt.guard.js';
import type { SessionPrincipal } from '../auth/sessions.service.js';
import { CurrentMailbox, CurrentMailboxGuard } from '../mailboxes/current-mailbox.guard.js';
import { RateLimit } from '../common/rate-limit/index.js';
import { OnboardingService } from './onboarding.service.js';
import type { TriageQueueRow } from '../triage/triage.read-service.js';

@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  /** GET /api/onboarding/state — flags the step machine derives from. */
  @Get('state')
  @UseGuards(JwtGuard)
  @RateLimit('triage-load')
  async state(@CurrentUser() principal: SessionPrincipal): Promise<Envelope<OnboardingState>> {
    return ok(await this.onboarding.getState(principal.userId));
  }

  /**
   * POST /api/onboarding/preset-picks — D110 step-4 submission.
   * Persists the picks in preferences (durable even pre-seed) and
   * reconciles any seeded preset rules for the active mailbox.
   */
  @Post('preset-picks')
  @UseGuards(JwtGuard, CurrentMailboxGuard, CsrfGuard)
  @RateLimit('triage-load')
  async submitPresetPicks(
    @CurrentUser() principal: SessionPrincipal,
    @CurrentMailbox() mailbox: { id: string },
    @Body() body: unknown,
  ): Promise<Envelope<OnboardingPresetPicksResult>> {
    const parsed = OnboardingPresetPicksRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Invalid preset picks.');
    }
    return ok(
      await this.onboarding.submitPresetPicks(
        principal.userId,
        mailbox.id,
        parsed.data.goal,
        parsed.data.presetKeys,
      ),
    );
  }

  /**
   * GET /api/onboarding/first-triage — D112 step-5 practice
   * candidates: the pinned (≤3) senders still awaiting a decision,
   * plus the pinned/decided meta the completion check reads.
   */
  @Get('first-triage')
  @UseGuards(JwtGuard, CurrentMailboxGuard)
  @RateLimit('triage-load')
  async firstTriage(
    @CurrentUser() principal: SessionPrincipal,
    @CurrentMailbox() mailbox: { id: string },
  ): Promise<Envelope<TriageQueueRow[], OnboardingFirstTriageMeta>> {
    const read = await this.onboarding.getFirstTriage(principal.userId, mailbox.id);
    return withMeta(read.rows, read.meta);
  }

  /**
   * POST /api/onboarding/complete — D113 completion (or D106 skip).
   * Idempotent; returns the updated state.
   */
  @Post('complete')
  @UseGuards(JwtGuard, CsrfGuard)
  @RateLimit('triage-load')
  async complete(
    @CurrentUser() principal: SessionPrincipal,
    @Body() body: unknown,
  ): Promise<Envelope<OnboardingState>> {
    const parsed = OnboardingCompleteRequestSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Invalid body.');
    }
    return ok(
      await this.onboarding.complete(principal.userId, {
        skipped: parsed.data.skipped === true,
      }),
    );
  }
}
