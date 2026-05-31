import { ConfigModule } from '@nestjs/config';
import { Module } from '@nestjs/common';

import { AccountModule } from './account/account.module.js';
import { ActionsModule } from './actions/actions.module.js';
import { ActivityModule } from './activity/activity.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AutopilotModule } from './autopilot/autopilot.module.js';
import { BriefModule } from './briefs/brief.module.js';
import { DbModule } from './db/db.module.js';
import { FollowupModule } from './followups/followup.module.js';
import { MailboxAccountsModule } from './mailboxes/mailbox-accounts.module.js';
import { RateLimitModule } from './common/rate-limit/index.js';
import { SecurityEventsModule } from './security-events/security-events.module.js';
import { SendersModule } from './senders/senders.module.js';
import { TriageModule } from './triage/triage.module.js';
import { UndoModule } from './undo/undo.module.js';
import { UsersModule } from './users/users.module.js';
import { WebhooksModule } from './webhooks/webhooks.module.js';

/**
 * The Gmail Pub/Sub push webhook (D8, D229) is loaded ONLY when
 * `PUBSUB_WEBHOOK_ENABLED=true`. The verifier requires
 * PUBSUB_PUSH_AUDIENCE + PUBSUB_PUSH_SA_EMAIL and crashes at boot
 * if either is missing — keeping the module unimported until the
 * env is configured avoids that bootstrap failure for envs that
 * don't ship the webhook yet.
 */
const pubsubWebhookEnabled = process.env.PUBSUB_WEBHOOK_ENABLED === 'true';

/**
 * Root application module (D201, D205).
 *
 * After the D155/D205 session-auth landing, AuthModule is unconditionally
 * imported — there is no longer a "Gmail connect disabled" mode. The
 * old `GMAIL_CONNECT_ENABLED` flag is gone; auth is core.
 *
 * Boot requirements:
 *   - DATABASE_URL              (DbModule)
 *   - JWT_ACCESS_SECRET / JWT_REFRESH_SECRET (AuthModule)
 *   - GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI
 *     (only invoked when the user hits /api/auth/google/start, so the
 *      service throws at first use instead of at boot — keeps the API
 *      bootable for test suites that never touch OAuth)
 *   - KMS_KEY_RESOURCE or ENCRYPTION_LOCAL_KEY (AuthCryptoModule)
 */
@Module({
  imports: [
    ConfigModule.forRoot(),
    DbModule,
    // Global so any feature can record to the D181 security audit log.
    SecurityEventsModule,
    // RateLimitModule is global (D156) — registered on every boot so
    // any `@RateLimit(...)` annotation is enforced. Fails open when
    // REDIS_URL is absent so local dev without Redis still works.
    RateLimitModule,
    UsersModule,
    MailboxAccountsModule,
    AuthModule,
    UndoModule,
    ActionsModule,
    SendersModule,
    TriageModule,
    AutopilotModule,
    BriefModule,
    FollowupModule,
    ActivityModule,
    AccountModule,
    ...(pubsubWebhookEnabled ? [WebhooksModule] : []),
  ],
})
export class AppModule {}
