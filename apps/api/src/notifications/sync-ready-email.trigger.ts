import { eq } from 'drizzle-orm';
import type { Queue } from 'bullmq';

import { mailboxAccounts } from '@declutrmail/db';
import type { MailboxSyncReadyPayload } from '@declutrmail/events';
import {
  enqueueEmailSend,
  SYNC_REMINDER_DELAY_MS,
  syncCompleteEmailJobId,
  syncReminderEmailJobId,
  type EmailSendJobData,
} from '@declutrmail/workers';

import type { DrizzleDb } from '../db/db.module.js';
import { syncCompleteEmail, syncReminder24hEmail } from './email-templates.js';

/**
 * D6 / D162 — `mailbox.sync_ready` → transactional email trigger.
 *
 * Consumed by the outbox consumer router (worker process). For each
 * sync_ready event it enqueues:
 *
 *   1. The sync-complete email, immediately. Idempotent on the OUTBOX
 *      EVENT id — a redelivered event cannot double-send.
 *   2. The 24h reminder, BullMQ-delayed, jobId per MAILBOX (one
 *      pending reminder per mailbox). Execution-time checks live in
 *      the EmailSendWorker: skipped when the user has session activity
 *      after `readyAt` ("returned") or has opted out (D165).
 *
 * Recipient resolution: `mailbox_accounts.user_id` — the user who
 * connected the mailbox. `provider_account_id` is the mailbox's own
 * Gmail address, used in the email copy so a two-mailbox user knows
 * WHICH inbox is ready. Counts + the user's own address only — no
 * message content (D7/D228).
 */
export interface SyncReadyEmailTriggerDeps {
  db: DrizzleDb;
  emailQueue: Queue<EmailSendJobData>;
  /** Web app origin for links, e.g. https://app.declutrmail.com (WEB_URL). */
  appUrl: string;
}

export type SyncReadyEmailHandler = (
  payload: MailboxSyncReadyPayload,
  eventId: string,
) => Promise<void>;

export function buildSyncReadyEmailHandler(deps: SyncReadyEmailTriggerDeps): SyncReadyEmailHandler {
  const appUrl = deps.appUrl.replace(/\/$/, '');
  return async function handleSyncReadyEmail(payload, eventId) {
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
      // email about. ACK (returning resolves the event) + log; a
      // retry could never find the row again.
      console.warn(
        JSON.stringify({
          level: 'warn',
          kind: 'email.sync_ready.mailbox_gone',
          mailboxAccountId: payload.mailboxAccountId,
          eventId,
        }),
      );
      return;
    }

    const complete = syncCompleteEmail({
      mailboxEmail: mailbox.mailboxEmail,
      messageCount: payload.messageCount,
      appUrl,
    });
    await enqueueEmailSend(deps.emailQueue, {
      kind: 'sync-complete',
      userId: mailbox.userId,
      subject: complete.subject,
      text: complete.text,
      idempotencyKey: syncCompleteEmailJobId(eventId),
      mailboxAccountId: payload.mailboxAccountId,
    });

    const reminder = syncReminder24hEmail({ mailboxEmail: mailbox.mailboxEmail, appUrl });
    await enqueueEmailSend(
      deps.emailQueue,
      {
        kind: 'sync-reminder-24h',
        userId: mailbox.userId,
        subject: reminder.subject,
        text: reminder.text,
        idempotencyKey: syncReminderEmailJobId(payload.mailboxAccountId),
        mailboxAccountId: payload.mailboxAccountId,
        skipIfUserActiveSince: payload.readyAt,
      },
      SYNC_REMINDER_DELAY_MS,
    );
  };
}
