import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

import type { EmailDeliveryOutcome, EmailDeliveryPort } from '@declutrmail/workers';

import { EMAIL_FROM } from './email-templates.js';
import { EmailSuppressionService } from './email-suppression.service.js';

/**
 * EmailService (D162) — the thin Resend client behind the
 * `EmailDeliveryPort` seam.
 *
 * Fail-closed: when `RESEND_API_KEY` is unset the service logs ONCE at
 * construction and every `deliver()` returns a typed
 * `{ ok: false, reason: 'disabled' }` — never a silent no-op, never a
 * pretend-send. The EmailSendWorker maps 'disabled' to a PermanentError
 * (dead-letter on attempt 1, Sentry capture), so a missing key in a
 * deployed env is loud, not an infinite retry loop.
 *
 * Suppression: every send consults the bounce/complaint suppression
 * list (D162; `EmailSuppressionService`) BEFORE calling Resend.
 *
 * Construction: NestJS provider in `NotificationsModule` AND manually
 * constructible (`new EmailService(suppression)`) for the worker
 * composition root — same dual pattern as `SecurityEventsService`.
 */
/**
 * The slice of the Resend SDK this service consumes — a seam so tests
 * inject a fake without network. `new Resend(key)` satisfies it.
 */
export interface ResendLikeClient {
  emails: {
    send(
      payload: { from: string; to: string; subject: string; text: string },
      options?: { idempotencyKey?: string },
    ): Promise<{
      data: { id: string } | null;
      error: { message: string; statusCode: number | null; name: string } | null;
    }>;
  };
}

@Injectable()
export class EmailService implements EmailDeliveryPort {
  private readonly logger = new Logger(EmailService.name);
  private readonly client: ResendLikeClient | null;

  constructor(
    private readonly suppression: EmailSuppressionService,
    clientOverride?: ResendLikeClient,
  ) {
    if (clientOverride) {
      this.client = clientOverride;
      return;
    }
    const apiKey = process.env.RESEND_API_KEY;
    if (apiKey) {
      this.client = new Resend(apiKey);
    } else {
      this.client = null;
      // Once, at construction — the per-send refusal logs again so
      // neither boot nor send path is ever silent about it.
      this.logger.error(
        'RESEND_API_KEY is not set — transactional email is DISABLED (fail-closed). ' +
          'Every send will be refused with a typed error. See .env.example.',
      );
    }
  }

  /** True when a provider key is configured. */
  get enabled(): boolean {
    return this.client !== null;
  }

  async deliver(input: {
    to: string;
    subject: string;
    text: string;
    idempotencyKey: string;
  }): Promise<EmailDeliveryOutcome> {
    if (!this.client) {
      this.logger.error(
        `email.send.refused_disabled idempotencyKey=${input.idempotencyKey} (RESEND_API_KEY unset)`,
      );
      return { ok: false, reason: 'disabled', detail: 'RESEND_API_KEY is not configured.' };
    }

    if (await this.suppression.isSuppressed(input.to)) {
      this.logger.warn(`email.send.suppressed idempotencyKey=${input.idempotencyKey}`);
      return { ok: false, reason: 'suppressed', detail: 'Recipient is on the suppression list.' };
    }

    try {
      const { data, error } = await this.client.emails.send(
        {
          from: EMAIL_FROM,
          to: input.to,
          subject: input.subject,
          text: input.text,
        },
        { idempotencyKey: input.idempotencyKey },
      );
      if (error) {
        // Resend reports API failures in-band. 4xx (validation, quota
        // config, bad from) cannot succeed on retry; 5xx / rate limits can.
        const retryable =
          error.statusCode === null ||
          error.statusCode >= 500 ||
          error.name === 'rate_limit_exceeded' ||
          error.name === 'concurrent_idempotent_requests';
        this.logger.error(
          `email.send.provider_error idempotencyKey=${input.idempotencyKey} ` +
            `code=${error.name} status=${error.statusCode ?? 'null'} retryable=${retryable}`,
        );
        return {
          ok: false,
          reason: retryable ? 'transient' : 'permanent',
          detail: `${error.name}: ${error.message}`,
        };
      }
      const providerId = data?.id ?? null;
      this.logger.log(
        `email.send.accepted idempotencyKey=${input.idempotencyKey} providerId=${providerId ?? 'null'}`,
      );
      return { ok: true, providerId };
    } catch (err) {
      // Network/transport failure before Resend answered — transient.
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `email.send.transport_error idempotencyKey=${input.idempotencyKey} message=${message}`,
      );
      return { ok: false, reason: 'transient', detail: message };
    }
  }
}
