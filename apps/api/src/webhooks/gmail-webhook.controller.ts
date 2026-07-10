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

import { SecurityEventsService } from '../security-events/security-events.service.js';
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
    private readonly securityEvents: SecurityEventsService,
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
      // D181: emit a `webhook.signature_failure` row BEFORE the 401
      // throws so the audit always reflects the rejection. Severity is
      // `warning` because a single failure is routine (network blips,
      // Google key rotations, malformed-token probes); operator
      // dashboards aggregate to spot true anomalies. Payload carries
      // the controlled `step` + `reason` discriminator the verifier
      // already produces — never the raw token bytes or the request
      // body, neither of which is consulted before this point.
      void this.securityEvents.record({
        eventType: 'webhook.signature_failure',
        severity: 'warning',
        payload: {
          source: 'pubsub.gmail',
          reason: 'oidc_verify_failed',
          step: verifyResult.step,
          subReason: verifyResult.reason,
        },
      });
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
      const parsed = JSON.parse(decoded) as { emailAddress?: unknown; historyId?: unknown };
      // Live Gmail pushes send historyId as a JSON number (uint64),
      // not the quoted string the docs example shows. Accept both.
      // A uint64 above 2^53 loses digits in JSON.parse, so for that
      // range recover the exact decimal text from the raw JSON.
      let historyId: string | undefined;
      if (typeof parsed.historyId === 'string') {
        historyId = parsed.historyId;
      } else if (typeof parsed.historyId === 'number' && Number.isFinite(parsed.historyId)) {
        historyId = Number.isSafeInteger(parsed.historyId)
          ? String(parsed.historyId)
          : /"historyId"\s*:\s*(\d+)\s*[,}]/.exec(decoded)?.[1];
      }
      if (
        typeof parsed.emailAddress !== 'string' ||
        historyId === undefined ||
        !/^\d+$/.test(historyId) ||
        // `provider_sync_state.last_history_id` is a signed Postgres
        // bigint — a cursor beyond 2^63-1 could never persist or
        // compare, so treat it as malformed rather than 500 downstream.
        BigInt(historyId) > 9223372036854775807n
      ) {
        throw new Error('Pub/Sub payload missing emailAddress or historyId.');
      }
      payload = { emailAddress: parsed.emailAddress, historyId };
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
      case 'deletion_pending':
        // D232 sync pause — service already warn-logged with mailbox id.
        // 200 designed no-op; Pub/Sub must not retry a state, not weather.
        break;
      case 'stale_history_id':
        this.logger.log(
          `pubsub.history_stale incoming=${outcome.incomingHistoryId} last=${outcome.lastHistoryId ?? 'null'}`,
        );
        break;
      case 'enqueued':
        this.logger.log(
          `pubsub.history_advanced mailbox=${outcome.mailboxAccountId} from=${outcome.previousHistoryId} to=${outcome.historyId}`,
        );
        break;
      case 'deferred_initial_sync_in_flight':
        this.logger.log(
          `pubsub.history_deferred_initial_sync mailbox=${outcome.mailboxAccountId} ` +
            `incoming=${outcome.incomingHistoryId}`,
        );
        break;
    }
  }
}
