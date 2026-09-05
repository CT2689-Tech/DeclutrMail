import { eq } from 'drizzle-orm';
import type { Queue } from 'bullmq';

import { mailboxAccounts } from '@declutrmail/db';
import type { MailboxSyncFailedPayload } from '@declutrmail/events';
import {
  enqueueEmailSend,
  syncFailedEmailJobId,
  type EmailSendJobData,
} from '@declutrmail/workers';

import type { DrizzleDb } from '../db/db.module.js';
import { syncFailedEmail } from './templates/index.js';

/**
 * D162 / D224 — `mailbox.sync_failed` → transactional notice trigger.
 *
 * Consumed by the outbox consumer router (worker process). One email
 * per event, but the JOB id is keyed per mailbox per UTC day
 * (`syncFailedEmailJobId`): a user hammering the retry against a broken
 * mailbox produces a terminal failure every few minutes, and each one
 * is a distinct outbox event — event-id keying would email every
 * attempt. Redelivered events dedup the same way.
 *
 * SYSTEM notice: no unsubscribe headers, no opt-out key, exempt from
 * the postal-address commercial block — the same footing as the
 * deletion notices. Recipient resolution mirrors the sync-ready
 * trigger: `mailbox_accounts.user_id`, with the mailbox's own address
 * in the copy so a two-mailbox user knows WHICH inbox stopped.
 */
export interface SyncFailedEmailTriggerDeps {
  db: DrizzleDb;
  emailQueue: Queue<EmailSendJobData>;
  /** Web app origin for the retry link, e.g. https://app.declutrmail.com (WEB_URL). */
  appUrl: string;
}

export type SyncFailedEmailHandler = (
  payload: MailboxSyncFailedPayload,
  eventId: string,
) => Promise<void>;

export function buildSyncFailedEmailHandler(
  deps: SyncFailedEmailTriggerDeps,
): SyncFailedEmailHandler {
  const appUrl = deps.appUrl.replace(/\/$/, '');
  return async function handleSyncFailedEmail(payload, eventId) {
    const [mailbox] = await deps.db
      .select({
        userId: mailboxAccounts.userId,
        mailboxEmail: mailboxAccounts.providerAccountId,
      })
      .from(mailboxAccounts)
      .where(eq(mailboxAccounts.id, payload.mailboxAccountId))
      .limit(1);

    if (!mailbox) {
      // Mailbox deleted between publish and dispatch — nothing to
      // email about. ACK + log; a retry could never find the row.
      console.warn(
        JSON.stringify({
          level: 'warn',
          kind: 'email.sync_failed.mailbox_gone',
          mailboxAccountId: payload.mailboxAccountId,
          eventId,
        }),
      );
      return;
    }

    const rendered = await syncFailedEmail({
      mailboxEmail: mailbox.mailboxEmail,
      mailboxAccountId: payload.mailboxAccountId,
      appUrl,
    });
    await enqueueEmailSend(deps.emailQueue, {
      kind: 'sync-failed',
      userId: mailbox.userId,
      subject: rendered.subject,
      text: rendered.text,
      ...(rendered.html === undefined ? {} : { html: rendered.html }),
      idempotencyKey: syncFailedEmailJobId(payload.mailboxAccountId, payload.failedAt),
      mailboxAccountId: payload.mailboxAccountId,
    });
  };
}
