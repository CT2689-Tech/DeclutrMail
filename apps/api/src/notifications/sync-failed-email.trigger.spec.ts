import { mailboxAccounts, users, workspaces } from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import type { EmailSendJobData } from '@declutrmail/workers';
import type { Queue } from 'bullmq';
import { expect, it, vi } from 'vitest';

import type { DrizzleDb } from '../db/db.module.js';
import { buildSyncFailedEmailHandler } from './sync-failed-email.trigger.js';

it('sends a secondary-mailbox failure back to that mailbox, not generic onboarding', async () => {
  const db = await freshTestDb();
  const [workspace] = await db.insert(workspaces).values({ name: 'Sync recovery' }).returning();
  const [user] = await db
    .insert(users)
    .values({
      workspaceId: workspace!.id,
      email: 'login@example.test',
    })
    .returning();
  const mailboxes = await db
    .insert(mailboxAccounts)
    .values(
      ['primary@example.test', 'secondary@example.test'].map((providerAccountId) => ({
        workspaceId: workspace!.id,
        userId: user!.id,
        provider: 'gmail' as const,
        providerAccountId,
      })),
    )
    .returning();
  const target = mailboxes[1]!;
  const queue = {
    getJob: vi.fn().mockResolvedValue(null),
    add: vi.fn().mockResolvedValue(undefined),
  };
  await buildSyncFailedEmailHandler({
    db: db as unknown as DrizzleDb,
    emailQueue: queue as unknown as Queue<EmailSendJobData>,
    appUrl: 'https://app.declutrmail.com/',
  })(
    {
      mailboxAccountId: target.id,
      workspaceId: workspace!.id,
      failedAt: '2026-09-05T12:00:00.000Z',
      errorCode: 'InvalidGrantError',
    },
    'sync-failed-event',
  );
  const message = queue.add.mock.calls[0]![1] as EmailSendJobData;
  const recoveryUrl = `https://app.declutrmail.com/onboarding?mailbox=${target.id}`;
  expect(message.mailboxAccountId).toBe(target.id);
  expect(message.text).toContain(recoveryUrl);
  expect(message.html).toContain(recoveryUrl);
  expect(message.text).not.toContain(mailboxes[0]!.id);
});
