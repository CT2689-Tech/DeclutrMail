import { and, eq } from 'drizzle-orm';
import { mailboxAccounts } from '@declutrmail/db';
import { enqueueEmailSend, isAwaitingReconnect } from '@declutrmail/workers';
import { gmailReconnectEmail } from './templates/gmail-reconnect.js';
import type {
  SyncFailedEmailHandler,
  SyncFailedEmailTriggerDeps,
} from './sync-failed-email.trigger.js';

/** Outbox delivery is at-least-once. Key on the incident, then recheck state at send time. */
export function buildGmailReconnectEmailHandler(
  deps: SyncFailedEmailTriggerDeps,
): SyncFailedEmailHandler {
  return async (payload) => {
    const [account] = await deps.db
      .select()
      .from(mailboxAccounts)
      .where(
        and(
          eq(mailboxAccounts.id, payload.mailboxAccountId),
          eq(mailboxAccounts.workspaceId, payload.workspaceId),
          eq(mailboxAccounts.status, 'active'),
        ),
      )
      .limit(1);
    if (!account || !(await isAwaitingReconnect(deps.db, account.id))) return;
    const rendered = await gmailReconnectEmail({
      mailboxEmail: account.providerAccountId,
      mailboxAccountId: account.id,
      appUrl: deps.appUrl,
    });
    await enqueueEmailSend(deps.emailQueue, {
      kind: 'gmail-reconnect',
      reconnectRequiredAt: payload.failedAt,
      userId: account.userId,
      mailboxAccountId: account.id,
      subject: rendered.subject,
      text: rendered.text,
      ...(rendered.html === undefined ? {} : { html: rendered.html }),
      idempotencyKey: `email__gmail-reconnect__${account.id}__${Date.parse(payload.failedAt)}`,
    });
  };
}
