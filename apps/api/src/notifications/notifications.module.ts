import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { UsersModule } from '../users/users.module.js';
import { EmailPrefsController } from './email-prefs.controller.js';
import { EmailService } from './email.service.js';
import { EmailSuppressionService } from './email-suppression.service.js';

/**
 * NotificationsModule (D162, D165) — transactional email.
 *
 *   - `EmailService` — thin Resend client behind the worker's
 *     `EmailDeliveryPort` seam. Fail-closed without RESEND_API_KEY.
 *   - `EmailSuppressionService` — bounce/complaint suppression list
 *     (written by the Resend webhook, read before every send).
 *   - `EmailPrefsController` — PATCH /api/me/email-prefs (D165 toggles).
 *
 * The EmailSendWorker itself runs in the worker process; its wiring
 * (queue + worker registration) lives in `apps/api/src/worker.ts`
 * (integration-owned) and constructs these services manually — both
 * are plain-constructible like `SecurityEventsService`.
 */
@Module({
  imports: [UsersModule, AuthModule],
  providers: [
    EmailSuppressionService,
    {
      // Factory (not class) provider: EmailService's optional second
      // constructor param is a TEST seam (fake Resend client) — Nest
      // must never try to resolve it from the DI container.
      provide: EmailService,
      useFactory: (suppression: EmailSuppressionService): EmailService =>
        new EmailService(suppression),
      inject: [EmailSuppressionService],
    },
  ],
  controllers: [EmailPrefsController],
  exports: [EmailService, EmailSuppressionService],
})
export class NotificationsModule {}
