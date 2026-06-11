import { Module } from '@nestjs/common';

import { NotificationsModule } from '../../notifications/notifications.module.js';
import { ResendWebhookController } from './resend-webhook.controller.js';

/**
 * ResendWebhookModule (D162) — bounce/complaint suppression intake.
 *
 * Unlike the Gmail Pub/Sub WebhooksModule (boot-crash posture behind
 * `PUBSUB_WEBHOOK_ENABLED`), this module loads unconditionally and the
 * controller fail-closes PER REQUEST with 503 while
 * `RESEND_WEBHOOK_SECRET` is unset — Resend retries 5xx, so the
 * suppression signal survives the configuration gap instead of the API
 * refusing to boot.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [ResendWebhookController],
})
export class ResendWebhookModule {}
