import { ConfigModule } from '@nestjs/config';
import { Module } from '@nestjs/common';

import { DbModule } from './db/db.module.js';
import { GoogleOAuthModule } from './auth/google-oauth.module.js';
import { RateLimitModule } from './common/rate-limit/index.js';
import { WebhooksModule } from './webhooks/webhooks.module.js';

/**
 * The Gmail OAuth connect feature is loaded ONLY when
 * `GMAIL_CONNECT_ENABLED=true`. Two reasons:
 *  1. The connect routes are unauthenticated until the D109/D224 auth
 *     layer lands, so they must be off by default.
 *  2. `GoogleOAuthModule` eagerly builds the KMS provider at bootstrap;
 *     leaving the module unimported means a missing KMS/encryption env
 *     can never brick API boot while the feature is off.
 * Node's --env-file flag populates `process.env` before any module code
 * runs, so this check is reliable at decoration time.
 */
const gmailConnectEnabled = process.env.GMAIL_CONNECT_ENABLED === 'true';

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
 * Root application module (D201). Loads env config, the global DB
 * module, and — when enabled — the feature modules.
 */
@Module({
  imports: [
    ConfigModule.forRoot(),
    DbModule,
    // RateLimitModule is global (D156) — registered on every boot so
    // any `@RateLimit(...)` annotation is enforced. Fails open when
    // REDIS_URL is absent so local dev without Redis still works.
    RateLimitModule,
    ...(gmailConnectEnabled ? [GoogleOAuthModule] : []),
    ...(pubsubWebhookEnabled ? [WebhooksModule] : []),
  ],
})
export class AppModule {}
