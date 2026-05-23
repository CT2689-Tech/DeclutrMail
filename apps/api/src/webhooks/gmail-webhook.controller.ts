import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  Post,
} from '@nestjs/common';

import { PubSubOidcVerifier, type OidcVerifyFailure } from './oidc-verifier.js';
import {
  GmailWebhookService,
  type GmailPubSubPayload,
  type ProcessOutcome,
} from './gmail-webhook.service.js';

/** DI token for the singleton OIDC verifier instance. */
export const PUBSUB_OIDC_VERIFIER = 'PUBSUB_OIDC_VERIFIER';

/**
 * Gmail Pub/Sub webhook controller (D8, D229).
 *
 * Route: `POST /api/webhooks/gmail/pubsub` (the global `api` prefix
 * is set in `main.ts`).
 *
 * Auth model: Pub/Sub authenticated push with OIDC token in the
 * `Authorization: Bearer <jwt>` header. The 8-step OIDC checklist
 * runs BEFORE any body access (Authorization is the first
 * decoration's first input).
 *
 * NEVER consults `x-goog-authenticated-user-email` — that header is
 * Cloud Run IAM identity, not Pub/Sub auth (D229).
 *
 * Response semantics:
 *   - 401 on ANY OIDC verifier failure (D229 contract)
 *   - 200 on successful processing (including silent-200 for
 *     dedup hits or out-of-order historyId — those are valid
 *     terminal outcomes per Pub/Sub at-least-once semantics)
 *   - 404 only when the resolved `emailAddress` does not map to a
 *     known mailbox (Pub/Sub treats 4xx as a permanent failure so
 *     this stops the retry loop for a deleted mailbox)
 *   - 400 on a malformed envelope (cannot decode base64 / JSON)
 *
 * The handler returns within milliseconds: dedup INSERT, monotonic
 * historyId UPDATE, and (in a follow-up PR) enqueue an
 * incremental-sync BullMQ job. No synchronous Gmail API call.
 */

/** Pub/Sub push envelope (Google's documented shape). */
interface PubSubEnvelope {
  message: {
    /** Globally-unique message ID assigned by Pub/Sub (dedup key). */
    messageId: string;
    /** base64-encoded payload — Gmail Pub/Sub publishes `{emailAddress, historyId}`. */
    data: string;
    publishTime?: string;
    attributes?: Record<string, string>;
  };
  subscription?: string;
}

@Controller('webhooks/gmail')
export class GmailWebhookController {
  private readonly logger = new Logger(GmailWebhookController.name);

  constructor(
    @Inject(PUBSUB_OIDC_VERIFIER) private readonly verifier: PubSubOidcVerifier,
    private readonly service: GmailWebhookService,
  ) {}

  @Post('pubsub')
  @HttpCode(HttpStatus.OK)
  async push(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: PubSubEnvelope,
  ): Promise<{ status: string }> {
    // OIDC verify FIRST — before any body parse beyond Nest's framework-level
    // JSON decode (which is unavoidable but doesn't trust the contents).
    const verifyResult = await this.verifier.verify(authorization);
    if (verifyResult.ok === false) {
      this.logVerifyFailure(verifyResult);
      // D229 contract: every OIDC failure is 401 (NOT 403, 200, or 204).
      throw new HttpException(
        { error: { code: 'UNAUTHORIZED', message: 'OIDC verification failed.' } },
        HttpStatus.UNAUTHORIZED,
      );
    }

    const messageId = body?.message?.messageId;
    const data = body?.message?.data;
    if (!messageId || typeof messageId !== 'string' || !data || typeof data !== 'string') {
      throw new HttpException(
        { error: { code: 'BAD_REQUEST', message: 'Malformed Pub/Sub envelope.' } },
        HttpStatus.BAD_REQUEST,
      );
    }

    let payload: GmailPubSubPayload;
    try {
      const decoded = Buffer.from(data, 'base64').toString('utf8');
      const parsed = JSON.parse(decoded) as Partial<GmailPubSubPayload>;
      if (
        typeof parsed.emailAddress !== 'string' ||
        typeof parsed.historyId !== 'string' ||
        !/^\d+$/.test(parsed.historyId)
      ) {
        throw new Error('Pub/Sub payload missing emailAddress or historyId.');
      }
      payload = { emailAddress: parsed.emailAddress, historyId: parsed.historyId };
    } catch {
      throw new HttpException(
        { error: { code: 'BAD_REQUEST', message: 'Malformed Pub/Sub data.' } },
        HttpStatus.BAD_REQUEST,
      );
    }

    const outcome = await this.service.processVerifiedPush({ messageId, payload });
    this.logOutcome(outcome);

    if (outcome.kind === 'unknown_mailbox') {
      // 4xx so Pub/Sub stops retrying.
      throw new HttpException(
        { error: { code: 'NOT_FOUND', message: 'Mailbox not found.' } },
        HttpStatus.NOT_FOUND,
      );
    }

    return { status: outcome.kind };
  }

  private logVerifyFailure(failure: OidcVerifyFailure): void {
    // Per D229: log at info, only rate-anomalies escalate to alert.
    // Never log the token or the request body in this path.
    this.logger.warn(
      `pubsub.oidc.deny step=${failure.step} reason=${failure.reason}` +
        ('email' in failure ? ` email=${failure.email}` : '') +
        ('aud' in failure ? ` aud=${failure.aud}` : '') +
        ('iss' in failure ? ` iss=${failure.iss}` : ''),
    );
  }

  private logOutcome(outcome: ProcessOutcome): void {
    switch (outcome.kind) {
      case 'duplicate_message_id':
        this.logger.log(`pubsub.dedup_hit messageId=${outcome.messageId}`);
        break;
      case 'unknown_mailbox':
        this.logger.warn(`pubsub.unknown_mailbox emailAddress=${outcome.emailAddress}`);
        break;
      case 'sync_state_uninitialized':
        // Service already warn-logged with mailbox id; nothing to add here.
        // (Outcome surfaces in the 200 response body for observability.)
        break;
      case 'stale_history_id':
        this.logger.log(
          `pubsub.history_stale incoming=${outcome.incomingHistoryId} last=${outcome.lastHistoryId ?? 'null'}`,
        );
        break;
      case 'enqueued':
        this.logger.log(
          `pubsub.history_advanced mailbox=${outcome.mailboxAccountId} from=${outcome.previousHistoryId ?? 'null'} to=${outcome.historyId}`,
        );
        break;
    }
  }
}
