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
import { type Envelope, ok } from '@declutrmail/shared/contracts';

import { CsrfGuard } from '../auth/csrf.guard.js';
import { JwtGuard } from '../auth/jwt.guard.js';
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
@UseGuards(JwtGuard, CurrentMailboxGuard, CsrfGuard)
export class AutopilotController {
  constructor(private readonly reads: AutopilotReadService) {}

  /** GET /api/autopilot/rules — list all Autopilot rules for the caller's mailbox. */
  @Get('rules')
  @RateLimit('triage-load')
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
