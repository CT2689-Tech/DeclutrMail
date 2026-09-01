import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';

import type { SupportRequestPayload, SupportRequestResult } from '@declutrmail/shared/contracts';

import { AppException } from '../common/app-exception.js';
import { EmailService } from '../notifications/email.service.js';
import { UsersService } from '../users/users.service.js';

const SUPPORT_INBOX = 'support@declutrmail.com';

interface SupportPrincipal {
  userId: string;
  workspaceId: string;
}

/**
 * SupportRequestService — the in-app "Contact support" form
 * (Settings → Help & glossary).
 *
 * Sends ONE email to `support@declutrmail.com` directly through
 * `EmailService`, not the `email-send` BullMQ queue: that pipeline
 * resolves its recipient FROM a userId and applies D165 opt-out
 * preferences built for mail sent TO a user. Here the recipient is
 * fixed and the user is the SENDER, so that machinery does not apply —
 * this calls the same underlying Resend seam directly. Suppression
 * (`EmailSuppressionService.isSuppressed()`) still runs, since it lives
 * inside `EmailService.deliver()` itself; it is a no-op here only
 * because the suppression list is keyed against the `users` table and
 * `support@declutrmail.com` isn't a user row.
 */
@Injectable()
export class SupportRequestService {
  private readonly logger = new Logger(SupportRequestService.name);

  constructor(
    private readonly users: UsersService,
    private readonly email: EmailService,
  ) {}

  async submit(
    principal: SupportPrincipal,
    payload: SupportRequestPayload,
  ): Promise<SupportRequestResult> {
    const user = await this.users.findById(principal.userId);
    const submittedAt = new Date();
    const text = [
      payload.message,
      '',
      '---',
      `User: ${user?.email ?? 'unknown'} (${principal.userId})`,
      `Workspace: ${principal.workspaceId}`,
      `Submitted: ${submittedAt.toISOString()}`,
    ].join('\n');

    const idempotencyKey = `support-request__${createHash('sha256')
      .update(`${principal.userId}:${payload.subject}:${payload.message}`)
      .digest('hex')}`;

    const outcome = await this.email.deliver({
      to: SUPPORT_INBOX,
      subject: `Support request: ${payload.subject}`,
      text,
      idempotencyKey,
      ...(user?.email ? { replyTo: user.email } : {}),
    });

    if (!outcome.ok) {
      this.logger.warn(
        `support_request.delivery_failed reason=${outcome.reason} idempotencyKey=${idempotencyKey}`,
      );
      throw new AppException({ code: 'SERVICE_UNAVAILABLE' });
    }

    return { submittedAt: submittedAt.toISOString() };
  }
}
