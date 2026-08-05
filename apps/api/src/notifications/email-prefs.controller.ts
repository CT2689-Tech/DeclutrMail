import { BadRequestException, Body, Controller, Patch, UseGuards } from '@nestjs/common';

import {
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
 * Toggleable categories: `reminders` (the 24h nudge), `syncComplete`
 * ("your inbox is ready" completion alerts), and `weeklyReceipt`
 * (D189 amended by D251, default off). SYSTEM
 * emails (deletion notices) are non-opt-out per D165 (CAN-SPAM/GDPR
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
    // Persist ONLY the keys the patch carries, merged in-database
    // (`UsersService.mergeEmailPrefs`). Writing a JS-materialised full
    // bag computed from a prior read would race the D165 one-click
    // endpoint: an unsubscribe landing between this handler's read and
    // write would be overwritten — silently resubscribing the user.
    const patch = {
      ...(parsed.data.reminders !== undefined ? { reminders: parsed.data.reminders } : {}),
      ...(parsed.data.syncComplete !== undefined ? { syncComplete: parsed.data.syncComplete } : {}),
      ...(parsed.data.weeklyReceipt !== undefined
        ? { weeklyReceipt: parsed.data.weeklyReceipt }
        : {}),
    };
    const preferences = await this.users.mergeEmailPrefs(user.userId, patch);
    // Display view materialises defaults; storage stays sparse.
    return ok({ emailPrefs: parseEmailPrefs(preferences) });
  }
}
