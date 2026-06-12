import { BadRequestException, Body, Controller, Patch, UseGuards } from '@nestjs/common';

import {
  DEFAULT_EMAIL_PREFS,
  EmailPrefsPatchSchema,
  ok,
  parseEmailPrefs,
  type EmailPrefs,
  type Envelope,
} from '@declutrmail/shared/contracts';

import { CsrfGuard } from '../auth/csrf.guard.js';
import { CurrentUser, JwtGuard } from '../auth/jwt.guard.js';
import type { SessionPrincipal } from '../auth/sessions.service.js';
import { RateLimit } from '../common/rate-limit/index.js';
import { UsersService } from '../users/users.service.js';

/**
 * PATCH /api/me/email-prefs (D162, D165).
 *
 * Minimal authed write surface for the email-notification toggles.
 * Stored under `users.preferences.emailPrefs`; the EmailSendWorker
 * reads the same key (via the shared `parseEmailPrefs` contract) at
 * send time, so a flipped toggle takes effect on the very next queued
 * reminder.
 *
 * Only REMINDER emails are toggleable — system emails (sync-complete,
 * deletion notices) are non-opt-out per D165 (CAN-SPAM/GDPR
 * transactional carve-out), so no key for them exists.
 */
@Controller('me/email-prefs')
@UseGuards(JwtGuard)
export class EmailPrefsController {
  constructor(private readonly users: UsersService) {}

  @Patch()
  @UseGuards(CsrfGuard)
  @RateLimit('default')
  async patch(
    @CurrentUser() user: SessionPrincipal,
    @Body() body: unknown,
  ): Promise<Envelope<{ emailPrefs: EmailPrefs }>> {
    const parsed = EmailPrefsPatchSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: parsed.error.issues[0]?.message ?? 'Invalid email-prefs patch.',
      });
    }
    const current = await this.users.findById(user.userId);
    const merged: EmailPrefs = {
      ...DEFAULT_EMAIL_PREFS,
      ...parseEmailPrefs(current?.preferences),
      // Spread only the keys the patch actually set (optional keys
      // would otherwise overwrite with `undefined`).
      ...(parsed.data.reminders !== undefined ? { reminders: parsed.data.reminders } : {}),
    };
    await this.users.patchPreferences(user.userId, { emailPrefs: merged });
    return ok({ emailPrefs: merged });
  }
}
