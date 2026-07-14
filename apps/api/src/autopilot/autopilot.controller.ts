// apps/api/src/autopilot/autopilot.controller.ts — HTTP surface for the
// Autopilot read + lightweight-mutation endpoints (D99-D105, D124, D234).
//
// Thin per D201/D204: validates input, delegates to
// `AutopilotReadService`, wraps the result in the D202 envelope.
//
// AUTH (D155 + D205): `JwtGuard` + `CurrentMailboxGuard` resolve the
// authenticated mailbox; the controller reads it via `@CurrentMailbox()`.
// State-changing routes also pass through `CsrfGuard`.
//
// TIER (D19): Autopilot is a Pro capability — every route 402s
// `PRO_FEATURE_REQUIRED` for under-tier workspaces via
// `CapabilityGuard`, EXCEPT the rules list, which onboarding's Step-4
// seed poll and read-only rule previews are available on every tier
// (see `@CapabilityExempt` below). Suggestions, stored Observe matches,
// Active execution, and every mutation remain Pro-gated.
//
// PRIVACY (D7, D228): read-only against engine signals + rule
// metadata; nothing returned contains body content. `sender_key` in
// match responses is the sha256 hex digest, never the raw email.

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  AutopilotApproveMatchesRequestSchema,
  type AutopilotApproveResult,
  type AutopilotRulePreviewResult,
  type Envelope,
  ok,
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
import { AutopilotReadService } from './autopilot.read-service.js';
import type { AutopilotRuleMode, AutopilotRuleScope } from '@declutrmail/db';

import type {
  AutopilotMatch,
  AutopilotMatchDismissResult,
  AutopilotPauseAllResult,
  AutopilotRule,
  AutopilotRulePatch,
} from './autopilot.types.js';

const ALLOWED_MODES = new Set(['observe', 'active', 'paused']);
const ALLOWED_SCOPES = new Set(['account', 'all_accounts', 'workspace']);

@Controller('autopilot')
@UseGuards(JwtGuard, CurrentMailboxGuard, CsrfGuard, CapabilityGuard)
@RequiresCapability('autopilot')
export class AutopilotController {
  constructor(private readonly reads: AutopilotReadService) {}

  /**
   * GET /api/autopilot/rules — list all Autopilot rules for the caller's
   * mailbox.
   *
   * D19 exemption: onboarding's Step-4 seed poll (`step-preset-pick`)
   * reads this list on EVERY tier — the preset names/modes are catalog
   * metadata, not the Pro value. Suggestions, matches, and every
   * mutation stay behind the class-level `@RequiresCapability`.
   */
  @Get('rules')
  @RateLimit('triage-load')
  @CapabilityExempt()
  async listRules(@CurrentMailbox() mailbox: { id: string }): Promise<Envelope<AutopilotRule[]>> {
    const accountId = mailbox.id;
    const rules = await this.reads.listRules(accountId);
    return ok(rules);
  }

  /** GET /api/autopilot/rules/:id — single rule by id. */
  @Get('rules/:id')
  @RateLimit('triage-load')
  async getRule(
    @CurrentMailbox() mailbox: { id: string },
    @Param('id') id: string,
  ): Promise<Envelope<AutopilotRule>> {
    const accountId = mailbox.id;
    if (!isUuid(id)) {
      throw new BadRequestException('Rule id must be a UUID.');
    }
    const rule = await this.reads.getRule(accountId, id);
    if (!rule) {
      throw notFound('Rule not found.');
    }
    return ok(rule);
  }

  /**
   * GET /api/autopilot/rules/:id/matches — recent matches for one
   * rule. Default 10, max 50.
   */
  @Get('rules/:id/matches')
  @RateLimit('triage-load')
  async listMatchesForRule(
    @CurrentMailbox() mailbox: { id: string },
    @Param('id') id: string,
    @Query('limit') rawLimit: string | undefined,
  ): Promise<Envelope<AutopilotMatch[]>> {
    const accountId = mailbox.id;
    if (!isUuid(id)) {
      throw new BadRequestException('Rule id must be a UUID.');
    }
    const limit = parsePositiveInt(rawLimit, 10);
    const matches = await this.reads.listMatchesForRule(accountId, id, limit);
    if (matches === null) {
      throw notFound('Rule not found.');
    }
    return ok(matches);
  }

  /**
   * PATCH /api/autopilot/rules/:id — toggle enabled, change mode,
   * adjust threshold, change scope. At V2 launch the API rejects
   * custom rules (`is_preset = false`) by returning 404 per D234.
   */
  @Patch('rules/:id')
  @RateLimit('triage-load')
  async patchRule(
    @CurrentMailbox() mailbox: { id: string },
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<Envelope<AutopilotRule>> {
    const accountId = mailbox.id;
    if (!isUuid(id)) {
      throw new BadRequestException('Rule id must be a UUID.');
    }
    const patch = parseRulePatch(body);
    const rule = await this.reads.patchRule(accountId, id, patch);
    if (!rule) {
      throw notFound('Rule not found.');
    }
    return ok(rule);
  }

  /**
   * POST /api/autopilot/pause-all — D105 global pause. Flips every
   * non-paused rule to `mode='paused'` for the caller's mailbox.
   */
  @Post('pause-all')
  @RateLimit('triage-load')
  async pauseAll(
    @CurrentMailbox() mailbox: { id: string },
  ): Promise<Envelope<AutopilotPauseAllResult>> {
    const accountId = mailbox.id;
    const result = await this.reads.pauseAll(accountId);
    return ok(result);
  }

  /**
   * GET /api/autopilot/pending-suggestions — D104 Observe-mode
   * suggestions awaiting the user's decision. Newest first; 50 max.
   */
  @Get('pending-suggestions')
  @RateLimit('triage-load')
  async listPendingSuggestions(
    @CurrentMailbox() mailbox: { id: string },
  ): Promise<Envelope<AutopilotMatch[]>> {
    const accountId = mailbox.id;
    const matches = await this.reads.listPendingSuggestions(accountId);
    return ok(matches);
  }

  /**
   * POST /api/autopilot/matches/:matchId/dismiss — D104 dismiss a
   * pending Observe-mode suggestion. Idempotent; cross-tenant /
   * non-pending matches collapse to 404.
   */
  @Post('matches/:matchId/dismiss')
  @RateLimit('triage-load')
  async dismissMatch(
    @CurrentMailbox() mailbox: { id: string },
    @Param('matchId') matchId: string,
  ): Promise<Envelope<AutopilotMatchDismissResult>> {
    const accountId = mailbox.id;
    if (!isUuid(matchId)) {
      throw new BadRequestException('Match id must be a UUID.');
    }
    const result = await this.reads.dismissMatch(accountId, matchId);
    if (!result) {
      throw notFound('Match not found.');
    }
    return ok(result);
  }

  /**
   * POST /api/autopilot/matches/approve — U14/D104 "Approve selected".
   * Body: `{ matchIds: uuid[] }` (1–100). Flips pending Observe-mode
   * suggestions to `approved` + enqueues the action sweep. Idempotent
   * — replays return `approvedCount=0` with `alreadyResolvedCount`.
   */
  @Post('matches/approve')
  @RateLimit('triage-load')
  async approveMatches(
    @CurrentMailbox() mailbox: { id: string },
    @Body() body: unknown,
  ): Promise<Envelope<AutopilotApproveResult>> {
    const parsed = AutopilotApproveMatchesRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('Body must be { matchIds: uuid[] } with 1-100 ids.');
    }
    const result = await this.reads.approveMatches(mailbox.id, parsed.data.matchIds);
    return ok(result);
  }

  /**
   * POST /api/autopilot/rules/:id/approve-all — U14/D104 "Approve all".
   * Approves every pending Observe-mode suggestion for the rule +
   * enqueues the action sweep. Does NOT change the rule's mode — the
   * D104 "and switch to Active" variant is this + `PATCH mode=active`.
   */
  @Post('rules/:id/approve-all')
  @RateLimit('triage-load')
  async approveAllForRule(
    @CurrentMailbox() mailbox: { id: string },
    @Param('id') id: string,
  ): Promise<Envelope<AutopilotApproveResult>> {
    if (!isUuid(id)) {
      throw new BadRequestException('Rule id must be a UUID.');
    }
    const result = await this.reads.approveAllForRule(mailbox.id, id);
    if (!result) {
      throw notFound('Rule not found.');
    }
    return ok(result);
  }

  /**
   * POST /api/autopilot/rules/:id/preview — U14 dry-run preview (D103
   * scoped to presets per D192). Read-only: runs the rule's matcher
   * against current signals; returns the would-match count + a 10-row
   * metadata-only sample. Custom rules 404 per D234.
   */
  @Post('rules/:id/preview')
  @RateLimit('triage-load')
  @CapabilityExempt()
  async previewRule(
    @CurrentMailbox() mailbox: { id: string },
    @Param('id') id: string,
  ): Promise<Envelope<AutopilotRulePreviewResult>> {
    if (!isUuid(id)) {
      throw new BadRequestException('Rule id must be a UUID.');
    }
    const result = await this.reads.previewRule(mailbox.id, id);
    if (!result) {
      throw notFound('Rule not found.');
    }
    return ok(result);
  }
}

function parseRulePatch(body: unknown): AutopilotRulePatch {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('Request body must be a JSON object.');
  }
  const obj = body as Record<string, unknown>;
  const out: AutopilotRulePatch = {};

  if ('enabled' in obj) {
    if (typeof obj.enabled !== 'boolean') {
      throw new BadRequestException('`enabled` must be a boolean.');
    }
    out.enabled = obj.enabled;
  }
  if ('mode' in obj) {
    if (typeof obj.mode !== 'string' || !ALLOWED_MODES.has(obj.mode)) {
      throw new BadRequestException('`mode` must be one of: observe, active, paused.');
    }
    out.mode = obj.mode as AutopilotRuleMode;
  }
  if ('scope' in obj) {
    if (typeof obj.scope !== 'string' || !ALLOWED_SCOPES.has(obj.scope)) {
      throw new BadRequestException('`scope` must be one of: account, all_accounts, workspace.');
    }
    out.scope = obj.scope as AutopilotRuleScope;
  }
  if ('confidenceThreshold' in obj) {
    if (obj.confidenceThreshold === null) {
      out.confidenceThreshold = null;
    } else if (typeof obj.confidenceThreshold === 'number') {
      out.confidenceThreshold = obj.confidenceThreshold;
    } else {
      throw new BadRequestException('`confidenceThreshold` must be a number in [0, 1] or null.');
    }
  }
  if ('observePromptDismissed' in obj) {
    if (typeof obj.observePromptDismissed !== 'boolean') {
      throw new BadRequestException('`observePromptDismissed` must be a boolean.');
    }
    out.observePromptDismissed = obj.observePromptDismissed;
  }

  return out;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function notFound(message: string): HttpException {
  return new HttpException({ message }, HttpStatus.NOT_FOUND);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
