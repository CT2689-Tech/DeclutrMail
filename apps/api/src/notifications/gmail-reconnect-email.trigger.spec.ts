import { mailboxAccounts, providerSyncState, users, workspaces } from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import { buildOutboxConsumer } from '../outbox/outbox-consumer-router.js';
import { buildGmailReconnectEmailHandler } from './gmail-reconnect-email.trigger.js';
import { EmailSendWorker, type EmailSendJobData } from '@declutrmail/workers';
import { eq } from 'drizzle-orm';
import { expect, it, vi } from 'vitest';

it('routes a reconnect incident to the exact mailbox and suppresses delivery after recovery', async () => {
  const db = await freshTestDb();
  const [workspace] = await db.insert(workspaces).values({ name: 'Recovery' }).returning();
  const [user] = await db
    .insert(users)
    .values({ workspaceId: workspace!.id, email: 'owner@example.test' })
    .returning();
  const [account] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId: workspace!.id,
      userId: user!.id,
      provider: 'gmail',
      providerAccountId: 'secondary@example.test',
    })
    .returning();
  const failedAt = new Date('2026-09-05T12:00:00Z');
  await db
    .insert(providerSyncState)
    .values({
      mailboxAccountId: account!.id,
      readinessStatus: 'ready',
      lastIncrementalErrorCode: 'InvalidGrantError',
      lastIncrementalErrorAt: failedAt,
    });
  const queue = { getJob: vi.fn().mockResolvedValue(null), add: vi.fn() };
  const handler = buildGmailReconnectEmailHandler({
    db: db as never,
    emailQueue: queue as never,
    appUrl: 'https://app.declutrmail.com',
  });
  const consume = buildOutboxConsumer(db as never, { onMailboxReconnectRequired: handler });
  const event = {
    id: 'incident',
    topic: 'mailbox.reconnect_required',
    aggregateId: account!.id,
    attempts: 1,
    createdAt: failedAt,
    payload: {
      mailboxAccountId: account!.id,
      workspaceId: workspace!.id,
      errorCode: 'InvalidGrantError',
      failedAt: failedAt.toISOString(),
    },
  };
  await consume(event);
  const payload = queue.add.mock.calls[0]![1] as EmailSendJobData;
  expect(payload.kind).toBe('gmail-reconnect');
  expect(payload.text).toContain(`/settings#mailbox-${account!.id}`);
  expect(payload.html).toContain(`/settings#mailbox-${account!.id}`);
  const deliver = vi.fn().mockResolvedValue({ ok: true, providerId: 'test' });
  const worker = new EmailSendWorker({ db: db as never, delivery: { deliver } });
  const context = { jobId: 'test', attempt: 1 } as never;
  // System notice works with the existing empty postal-address config.
  expect((await worker.processJob(payload, context)).outcome).toBe('sent');
  expect(deliver).toHaveBeenCalledTimes(1);
  await db
    .update(providerSyncState)
    .set({ lastSyncedAt: new Date('2026-09-05T13:00:00Z') })
    .where(eq(providerSyncState.mailboxAccountId, account!.id));
  expect((await worker.processJob(payload, context)).outcome).toBe('skipped_recovered');
  expect(deliver).toHaveBeenCalledTimes(1);
  await consume(event);
  expect(queue.add).toHaveBeenCalledTimes(1);
  await expect(buildOutboxConsumer(db as never)(event)).rejects.toThrow('not wired');
});
