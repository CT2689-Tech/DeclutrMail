import { BadRequestException, Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';

import {
  ActionSheetPrefsPatchSchema,
  BriefPrefsPatchSchema,
  DEFAULT_ACTION_SHEET_PREFS,
  DEFAULT_BRIEF_PREFS,
  ok,
  parseActionSheetPrefs,
  parseBriefPrefs,
  parseEmailPrefs,
  type ActionSheetPrefs,
  type BriefPrefs,
  type Envelope,
  type MeSettings,
} from '@declutrmail/shared/contracts';

import { CsrfGuard } from '../auth/csrf.guard.js';
import { CurrentUser, JwtGuard } from '../auth/jwt.guard.js';
import type { SessionPrincipal } from '../auth/sessions.service.js';
import { RateLimit } from '../common/rate-limit/index.js';
import { UsersService } from '../users/users.service.js';

/**
 * Settings read + D34 action-sheet prefs write (U23).
 *
 *   - GET   /api/me/settings           — one read for the Settings
 *     index: `{ emailPrefs, actionSheetPrefs, briefPrefs }`, all parsed
 *     from the `users.preferences` jsonb bag with safe defaults.
 *   - PATCH /api/me/action-sheet-prefs — per-verb "skip the action
 *     sheet" toggles (D34). The action PREVIEW is never skippable
 *     (D226) — this preference only controls the wrapping sheet UI.
 *   - PATCH /api/me/brief-prefs — D66 "Generate Brief on weekends
 *     too" opt-in (Mon–Fri is the default schedule).
 *
 * USER-scoped (JwtGuard only, no CurrentMailboxGuard): preferences
 * roam mailboxes and must work with zero connected accounts. Email
 * prefs keep their own PATCH at /api/me/email-prefs (D165 — the
 * EmailSendWorker shares that contract); this controller only READS
 * them for the combined settings payload.
 */
@Controller('me')
@UseGuards(JwtGuard)
export class MeSettingsController {
  constructor(private readonly users: UsersService) {}

  @Get('settings')
  @RateLimit('default')
  async settings(@CurrentUser() user: SessionPrincipal): Promise<Envelope<MeSettings>> {
    const current = await this.users.findById(user.userId);
    return ok({
      emailPrefs: parseEmailPrefs(current?.preferences),
      actionSheetPrefs: parseActionSheetPrefs(current?.preferences),
      briefPrefs: parseBriefPrefs(current?.preferences),
    });
  }

  @Patch('action-sheet-prefs')
  @UseGuards(CsrfGuard)
  @RateLimit('default')
  async patchActionSheetPrefs(
    @CurrentUser() user: SessionPrincipal,
    @Body() body: unknown,
  ): Promise<Envelope<{ actionSheetPrefs: ActionSheetPrefs }>> {
    const parsed = ActionSheetPrefsPatchSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: parsed.error.issues[0]?.message ?? 'Invalid action-sheet-prefs patch.',
      });
    }
    const current = await this.users.findById(user.userId);
    const merged: ActionSheetPrefs = {
      ...DEFAULT_ACTION_SHEET_PREFS,
      ...parseActionSheetPrefs(current?.preferences),
      // Spread only the keys the patch actually set (optional keys
      // would otherwise overwrite with `undefined`).
      ...(parsed.data.archive !== undefined ? { archive: parsed.data.archive } : {}),
      ...(parsed.data.unsubscribe !== undefined ? { unsubscribe: parsed.data.unsubscribe } : {}),
      ...(parsed.data.later !== undefined ? { later: parsed.data.later } : {}),
    };
    await this.users.patchPreferences(user.userId, { actionSheetPrefs: merged });
    return ok({ actionSheetPrefs: merged });
  }

  /**
   * PATCH /api/me/brief-prefs (D66) — the "Generate Brief on weekends
   * too" opt-in. Stored under `users.preferences.briefPrefs`; the
   * BriefSnapshotWorker reads the same key (via the shared
   * `parseBriefPrefs` contract) at generation time, so a flipped toggle
   * takes effect on the very next hourly tick.
   */
  @Patch('brief-prefs')
  @UseGuards(CsrfGuard)
  @RateLimit('default')
  async patchBriefPrefs(
    @CurrentUser() user: SessionPrincipal,
    @Body() body: unknown,
  ): Promise<Envelope<{ briefPrefs: BriefPrefs }>> {
    const parsed = BriefPrefsPatchSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: parsed.error.issues[0]?.message ?? 'Invalid brief-prefs patch.',
      });
    }
    const current = await this.users.findById(user.userId);
    const merged: BriefPrefs = {
      ...DEFAULT_BRIEF_PREFS,
      ...parseBriefPrefs(current?.preferences),
      // Spread only the keys the patch actually set (optional keys
      // would otherwise overwrite with `undefined`).
      ...(parsed.data.weekends !== undefined ? { weekends: parsed.data.weekends } : {}),
    };
    await this.users.patchPreferences(user.userId, { briefPrefs: merged });
    return ok({ briefPrefs: merged });
  }
}
