import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { webhookDedup } from '@declutrmail/db';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/db.module.js';
import type { Request } from 'express';
import { z } from 'zod';

import { RateLimit } from '../../common/rate-limit/index.js';
import { SecurityEventsService } from '../../security-events/security-events.service.js';
import {
  EmailSuppressionService,
  type SuppressionReason,
} from '../../notifications/email-suppression.service.js';
import { verifyResendSignature } from './resend-signature.js';

/**
 * Resend webhook (D162) — `POST /api/webhooks/resend`.
 *
 * Purpose: bounce/complaint suppression. When Resend reports
 * `email.bounced` or `email.complained`, the recipient lands on the
 * suppression list (`users.preferences.emailSuppression`) and every
 * future send is refused BEFORE calling Resend.
 *
 * Auth model — svix-style signature (Standard Webhooks):
 *   - `RESEND_WEBHOOK_SECRET` unset → 503 fail-closed. The endpoint
 *     refuses to process ANYTHING it cannot verify; Resend retries
 *     5xx, so deliveries are not lost while the founder configures
 *     the secret.
 *   - Bad/missing signature or stale timestamp → 401, plus a D181
 *     `webhook.signature_failure` security event.
 *   - Verification runs against the RAW body bytes (`rawBody: true`
 *     in main.ts) — never a re-serialization.
 *
 * Rate-limited (unauthenticated endpoint — CLAUDE.md hard rule) via
 * the `default` bucket keyed on IP.
 *
 * Event types other than bounce/complaint ACK with 200 and are
 * logged — Resend should not retry deliveries we deliberately ignore.
 *
 * Privacy: the handler reads ONLY `type` + `data.to` from the payload
 * (our own outbound transactional email's metadata — no user mail
 * content is ever in a Resend webhook for plain-text sends). Nothing
 * from the body is logged except the event type.
 */

/** The minimal slice of a Resend webhook envelope this handler reads. */
const ResendEventSchema = z.object({
  type: z.string(),
  // Default (strip) object mode — unknown payload keys are ignored.
  data: z
    .object({
      to: z.union([z.string(), z.array(z.string())]).optional(),
    })
    .optional(),
});

/** Resend event type → suppression reason. */
const SUPPRESSING_EVENTS: Record<string, SuppressionReason> = {
  'email.bounced': 'bounce',
  'email.complained': 'complaint',
};

@Controller('webhooks/resend')
export class ResendWebhookController {
  private readonly logger = new Logger(ResendWebhookController.name);

  constructor(
    private readonly suppression: EmailSuppressionService,
    private readonly securityEvents: SecurityEventsService,
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @RateLimit('default')
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers('svix-id') svixId: string | undefined,
    @Headers('svix-timestamp') svixTimestamp: string | undefined,
    @Headers('svix-signature') svixSignature: string | undefined,
  ): Promise<{ status: string }> {
    const secret = process.env.RESEND_WEBHOOK_SECRET;
    if (!secret) {
      // Fail-closed: unverifiable deliveries are never processed.
      // 503 (not 401) so Resend keeps retrying until the secret is
      // configured — no suppression signal is permanently lost.
      this.logger.error(
        'resend.webhook.secret_unset — refusing delivery (fail-closed). ' +
          'Set RESEND_WEBHOOK_SECRET; see .env.example.',
      );
      throw new ServiceUnavailableException({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Webhook secret not configured.',
      });
    }

    const rawBody = req.rawBody;
    if (!rawBody || rawBody.length === 0) {
      throw new BadRequestException({ code: 'BAD_REQUEST', message: 'Empty webhook body.' });
    }

    const verdict = verifyResendSignature({
      rawBody,
      svixId,
      svixTimestamp,
      svixSignature,
      secret,
    });
    if (!verdict.ok) {
      this.logger.warn(`resend.webhook.deny reason=${verdict.reason}`);
      // D181 audit row BEFORE the 401 — mirrors the Gmail Pub/Sub
      // controller. Controlled discriminator only; never raw headers
      // or body bytes.
      void this.securityEvents.record({
        eventType: 'webhook.signature_failure',
        severity: 'warning',
        payload: {
          source: 'resend',
          reason: 'signature_verify_failed',
          step: verdict.reason,
        },
      });
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Webhook signature verification failed.',
      });
    }

    // svix-id delivery dedup (webhook hygiene, 2026-07-28). The
    // signature check above binds svix-id into the signed content
    // (Standard Webhooks signs `id.timestamp.body`), so a VERIFIED
    // delivery id is attacker-stable — a replay inside the 5-minute
    // timestamp window carries the same id and lands here as a
    // duplicate instead of re-applying the suppression. Namespaced so
    // Resend ids can never collide with Pub/Sub messageIds in the
    // shared table. Verified-only: unverified traffic (401 above)
    // must not be able to consume dedup space.
    if (svixId) {
      const dedup = await this.db
        .insert(webhookDedup)
        .values({
          messageId: `resend:${svixId}`,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        })
        .onConflictDoNothing({ target: webhookDedup.messageId })
        .returning({ messageId: webhookDedup.messageId });
      if (dedup.length === 0) {
        this.logger.log(`resend.webhook.duplicate svix_id=${svixId}`);
        return { status: 'duplicate' };
      }
    }

    // The dedup row above is COMMITTED, and everything that actually
    // does the work happens below it. Without the compensation in the
    // catch, a failure here consumed the slot permanently: the request
    // 500s, Resend retries the same svix-id, the insert conflicts,
    // `dedup.length === 0` answers `duplicate`, and the bounce or
    // complaint is dropped for good — so DeclutrMail keeps mailing a
    // hard-bounced or complaining address, which is the exact outcome
    // the suppression list exists to prevent (audit 2026-08-21).
    //
    // Releasing the slot is safe because the work is idempotent:
    // `suppress()` returns `already_suppressed` when the preference is
    // already set, so a re-delivered event costs a no-op, while a
    // dropped one costs deliverability. The sibling webhooks each solve
    // this differently — Gmail puts the insert INSIDE the state
    // transaction, billing keeps a `processed_at` and resumes an
    // unprocessed duplicate. `webhook_dedup` has no such column, and
    // adding one is a migration, so this compensates instead.
    //
    // Residual: a process death between the failure and the delete
    // still strands the slot until `expiresAt`. That is strictly better
    // than stranding it on every ordinary error.
    try {
      return await this.processVerifiedEvent(rawBody);
    } catch (err) {
      // Only release the slot for failures a RETRY could resolve. A
      // malformed payload (400) is deterministic — it fails identically
      // every time — so holding the slot there stops a pointless retry
      // loop, which is what dedup is for. The failure this exists to
      // catch is the transient one: the suppression write throwing on a
      // pool blip or a mid-deploy SIGTERM.
      const deterministic = err instanceof HttpException && err.getStatus() < 500;
      if (svixId && !deterministic) {
        await this.db
          .delete(webhookDedup)
          .where(eq(webhookDedup.messageId, `resend:${svixId}`))
          .catch(() => {
            // Best-effort: the throw below is what matters, and the row
            // expires on its own. Swallowing here must not mask the
            // original failure.
          });
      }
      throw err;
    }
  }

  /** The acting half — everything past the signature + dedup gates. */
  private async processVerifiedEvent(
    rawBody: Buffer,
  ): Promise<{ status: 'ignored' | 'suppressed' }> {
    let event: z.infer<typeof ResendEventSchema>;
    try {
      event = ResendEventSchema.parse(JSON.parse(rawBody.toString('utf8')));
    } catch {
      throw new BadRequestException({ code: 'BAD_REQUEST', message: 'Malformed webhook payload.' });
    }

    const reason = SUPPRESSING_EVENTS[event.type];
    if (!reason) {
      // Deliveries we don't act on (email.sent, email.delivered, …)
      // ACK so Resend doesn't retry. These used to also fire a PostHog
      // event for D126 Part 1 delivery visibility; that was removed
      // (F004) because analytics consent is per-browser and no server
      // process can read it, so anything sent from here reached PostHog
      // for people who declined it. The delivery data was duplicate
      // anyway — Resend's own dashboard and the `email_send` worker logs
      // both carry it. No open beacon either: opens are deliberately NOT
      // tracked (founder decision 2026-07-27).
      this.logger.log(`resend.webhook.ignored type=${event.type}`);
      return { status: 'ignored' };
    }

    const recipients =
      typeof event.data?.to === 'string' ? [event.data.to] : (event.data?.to ?? []);
    let suppressed = 0;
    for (const recipient of recipients) {
      const outcome = await this.suppression.suppress(recipient, reason);
      if (outcome !== 'unknown_recipient') suppressed += 1;
    }
    this.logger.log(
      `resend.webhook.processed type=${event.type} recipients=${recipients.length} suppressed=${suppressed}`,
    );
    return { status: 'suppressed' };
  }
}
