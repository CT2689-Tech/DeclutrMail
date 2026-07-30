import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { mailboxAccounts, schema, users, workspaces } from '@declutrmail/db';
import type { Queue } from 'bullmq';
import type { EmailSendJobData } from '@declutrmail/workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildSyncReadyEmailHandler } from './sync-ready-email.trigger.js';
import type { DrizzleDb } from '../db/db.module.js';

/**
 * Sync-ready email trigger tests (D6, D162) — real PGlite for the
 * recipient resolution, fake BullMQ queue capturing enqueues.
 * (`pg.exec` is PGlite's SQL runner, not child_process.)
 */

const MIG_DIR = join(__dirname, '../../../../packages/db/migrations');

async function freshDb(): Promise<DrizzleDb> {
  const pg = new PGlite({ extensions: { citext } });
  const db = drizzle(pg, { schema }) as unknown as PgliteDatabase<typeof schema>;
  const files = readdirSync(MIG_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    await pg.exec(readFileSync(join(MIG_DIR, file), 'utf8'));
  }
  return db as unknown as DrizzleDb;
}

interface FakeQueue {
  add: ReturnType<typeof vi.fn>;
  getJob: ReturnType<typeof vi.fn>;
}

/**
 * `state` is what `enqueueEmailSend` actually consults — mere existence
 * is not enough, because `removeOnFail: false` keeps failed jobs forever
 * and a permanent jobId would otherwise bury that email for good. Live
 * by default so the redelivery-dedup tests read as intended.
 */
function fakeQueue(existingJobIds: string[] = [], state = 'delayed'): FakeQueue {
  return {
    add: vi.fn().mockResolvedValue(undefined),
    getJob: vi
      .fn()
      .mockImplementation((jobId: string) =>
        Promise.resolve(
          existingJobIds.includes(jobId)
            ? { id: jobId, getState: async () => state, remove: async () => undefined }
            : undefined,
        ),
      ),
  };
}

const READY_AT = '2026-06-11T08:00:00.000Z';

// The trigger signs RFC 8058 unsubscribe tokens at enqueue time (D165).
process.env.UNSUBSCRIBE_TOKEN_SECRET = 't'.repeat(32);

describe('buildSyncReadyEmailHandler', () => {
  let db: DrizzleDb;
  let mailboxId: string;
  let userId: string;

  beforeEach(async () => {
    db = await freshDb();
    const [w] = await db.insert(workspaces).values({ name: 'W' }).returning({ id: workspaces.id });
    const [u] = await db
      .insert(users)
      .values({ workspaceId: w!.id, email: 'login@x.com' })
      .returning({ id: users.id });
    userId = u!.id;
    const [m] = await db
      .insert(mailboxAccounts)
      .values({
        workspaceId: w!.id,
        userId: u!.id,
        provider: 'gmail',
        providerAccountId: 'inbox@gmail.com',
      })
      .returning({ id: mailboxAccounts.id });
    mailboxId = m!.id;
  });

  function payload(workspaceId?: string) {
    return {
      mailboxAccountId: mailboxId,
      workspaceId: workspaceId ?? '00000000-0000-4000-8000-000000000000',
      readyAt: READY_AT,
      messageCount: 4321,
    };
  }

  it('enqueues the sync-complete email and the delayed 24h reminder', async () => {
    const queue = fakeQueue();
    const handler = buildSyncReadyEmailHandler({
      db,
      emailQueue: queue as unknown as Queue<EmailSendJobData>,
      appUrl: 'https://app.declutrmail.com/',
      apiUrl: 'https://api.declutrmail.com',
    });

    await handler(payload(), 'ev-1');

    expect(queue.add).toHaveBeenCalledTimes(2);

    const [, completeData, completeOpts] = queue.add.mock.calls[0]! as [
      string,
      EmailSendJobData,
      { jobId: string; delay?: number },
    ];
    expect(completeData).toMatchObject({
      kind: 'sync-complete',
      userId,
      mailboxAccountId: mailboxId,
      idempotencyKey: 'email__sync-complete__ev-1',
    });
    // Counts + the user's own mailbox address only; trailing slash on
    // appUrl is normalized.
    expect(completeData.text).toContain('4,321 messages');
    expect(completeData.text).toContain('inbox@gmail.com');
    expect(completeData.text).toContain('https://app.declutrmail.com/triage');
    expect(completeOpts.jobId).toBe('email__sync-complete__ev-1');
    expect(completeOpts.delay).toBeUndefined();

    const [, reminderData, reminderOpts] = queue.add.mock.calls[1]! as [
      string,
      EmailSendJobData,
      { jobId: string; delay?: number },
    ];
    expect(reminderData).toMatchObject({
      kind: 'sync-reminder-24h',
      userId,
      idempotencyKey: `email__sync-reminder-24h__${mailboxId}`,
      skipIfUserActiveSince: READY_AT,
    });
    expect(reminderOpts.delay).toBe(24 * 60 * 60 * 1_000);

    // Multipart (D162): the rendered HTML twin rides the job.
    expect(completeData.html).toContain('https://app.declutrmail.com/triage');
    expect(reminderData.html).toContain('/triage');
  });

  it('attaches RFC 8058 headers to both sync emails', async () => {
    const queue = fakeQueue();
    const handler = buildSyncReadyEmailHandler({
      db,
      emailQueue: queue as unknown as Queue<EmailSendJobData>,
      appUrl: 'https://app.declutrmail.com',
      apiUrl: 'https://api.declutrmail.com/',
    });

    await handler(payload(), 'ev-1');

    const [, completeData] = queue.add.mock.calls[0]! as [string, EmailSendJobData];
    const [, reminderData] = queue.add.mock.calls[1]! as [string, EmailSendJobData];
    for (const data of [completeData, reminderData]) {
      expect(data.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
      // Trailing slash on apiUrl is normalized; the URL targets the API.
      expect(data.headers?.['List-Unsubscribe']).toMatch(
        /^<https:\/\/api\.declutrmail\.com\/api\/email\/unsubscribe\?t=.+>$/,
      );
    }
  });

  it('dedups on redelivery — existing jobIds are not re-enqueued', async () => {
    const queue = fakeQueue([
      'email__sync-complete__ev-1',
      `email__sync-reminder-24h__${mailboxId}`,
    ]);
    const handler = buildSyncReadyEmailHandler({
      db,
      emailQueue: queue as unknown as Queue<EmailSendJobData>,
      appUrl: 'https://app.declutrmail.com',
      apiUrl: 'https://api.declutrmail.com',
    });

    await handler(payload(), 'ev-1');
    expect(queue.add).not.toHaveBeenCalled();
  });

  // The reminder's jobId is keyed per MAILBOX and failed jobs are kept
  // forever, so a single terminal failure used to bury that mailbox's
  // reminder permanently — every later enqueue no-oped. Surfaced by the
  // CAN-SPAM postal refusal, where "set the address and reminders
  // resume" was simply false (Codex stop-review 2026-07-29).
  it('re-enqueues past a FAILED job so a terminal failure is not permanent', async () => {
    const queue = fakeQueue([`email__sync-reminder-24h__${mailboxId}`], 'failed');
    const handler = buildSyncReadyEmailHandler({
      db,
      emailQueue: queue as unknown as Queue<EmailSendJobData>,
      appUrl: 'https://app.declutrmail.com',
      apiUrl: 'https://api.declutrmail.com',
    });

    await handler(payload(), 'ev-1');

    const reminderAdds = queue.add.mock.calls.filter(
      (call) => (call[1] as EmailSendJobData).kind === 'sync-reminder-24h',
    );
    expect(reminderAdds).toHaveLength(1);
  });

  it('ACKs without enqueueing when the mailbox row is gone', async () => {
    const queue = fakeQueue();
    const handler = buildSyncReadyEmailHandler({
      db,
      emailQueue: queue as unknown as Queue<EmailSendJobData>,
      appUrl: 'https://app.declutrmail.com',
      apiUrl: 'https://api.declutrmail.com',
    });

    await handler(
      { ...payload(), mailboxAccountId: '00000000-0000-4000-8000-00000000dead' },
      'ev-2',
    );
    expect(queue.add).not.toHaveBeenCalled();
  });
});
