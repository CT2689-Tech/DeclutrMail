import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { AutopilotModule } from '../autopilot/autopilot.module.js';
import { MailboxAccountsModule } from '../mailboxes/mailbox-accounts.module.js';
import { TriageModule } from '../triage/triage.module.js';
import { OnboardingController } from './onboarding.controller.js';
import { OnboardingService } from './onboarding.service.js';

/**
 * OnboardingModule (D106-D113) — the step machine's API surface.
 *
 * Composes two existing read facades rather than re-querying foreign
 * tables (D204): the D112 first-triage candidates come from
 * `TriageReadService.listQueue` (so "decided" means exactly what the
 * production queue means), and the D110 preset reconcile goes through
 * `AutopilotReadService.patchRule` (so the D234 custom-rule gate and
 * tenant checks apply unchanged). The flow flags themselves live on
 * `users` (onboarded_at + two preferences keys), owned here.
 *
 * Eager-loadable at boot — only needs DATABASE_URL (global DbModule).
 */
@Module({
  imports: [AuthModule, MailboxAccountsModule, TriageModule, AutopilotModule],
  controllers: [OnboardingController],
  providers: [OnboardingService],
})
export class OnboardingModule {}
