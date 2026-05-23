import { Module } from '@nestjs/common';

import { GmailWebhookController, PUBSUB_OIDC_VERIFIER } from './gmail-webhook.controller.js';
import { GmailWebhookService } from './gmail-webhook.service.js';
import { PubSubOidcVerifier } from './oidc-verifier.js';

/**
 * WebhooksModule (D201) — owns the Gmail Pub/Sub push webhook (D8, D229).
 *
 * Loaded only when `PUBSUB_WEBHOOK_ENABLED=true` to keep the route
 * out of the routing table until both env vars are configured
 * (PUBSUB_PUSH_AUDIENCE, PUBSUB_PUSH_SA_EMAIL). The verifier is
 * built eagerly so a missing env crashes API boot rather than
 * silently 401-ing every webhook delivery.
 *
 * The route is unauthenticated at the HTTP layer (no session
 * cookie, no user ID) — auth is the OIDC JWT in the Authorization
 * header, NOT `x-goog-authenticated-user-email` (D229).
 */
@Module({
  controllers: [GmailWebhookController],
  providers: [
    GmailWebhookService,
    {
      provide: PUBSUB_OIDC_VERIFIER,
      useFactory: (): PubSubOidcVerifier => {
        const audience = process.env.PUBSUB_PUSH_AUDIENCE;
        const serviceAccountEmail = process.env.PUBSUB_PUSH_SA_EMAIL;
        if (!audience) {
          throw new Error('PUBSUB_PUSH_AUDIENCE is not set — see .env.example.');
        }
        if (!serviceAccountEmail) {
          throw new Error('PUBSUB_PUSH_SA_EMAIL is not set — see .env.example.');
        }
        return new PubSubOidcVerifier({ audience, serviceAccountEmail });
      },
    },
  ],
})
export class WebhooksModule {}
