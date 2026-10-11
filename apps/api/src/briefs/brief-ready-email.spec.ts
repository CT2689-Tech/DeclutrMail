import { randomUUID } from 'node:crypto';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { and, eq, sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { freshTestDb } from '@declutrmail/db/testing';
import {
  accountDeletionRequests,
  briefRuns,
  mailboxAccounts,
  mailboxDataDeletionRequests,
  providerSyncState,
  users,
  workspaces,
} from '@declutrmail/db';
import {
  BRIEF_EMAIL_SEND_QUEUE,
  BriefSnapshotWorker,
  EmailSendWorker,
  briefReadyEmailJobId,
  type EmailSendJobData,
  type WorkerContext,
} from '@declutrmail/workers';
import { DataExportService } from '../account/export.service.js';
import { hasBriefEmailConsent } from '@declutrmail/shared/contracts';
import { UnsubscribeController } from '../notifications/unsubscribe.controller.js';
import { signUnsubscribeToken } from '../notifications/unsubscribe-token.js';
import { EmailPrefsController } from '../notifications/email-prefs.controller.js';
import { UsersService } from '../users/users.service.js';
import type { SessionPrincipal } from '../auth/sessions.service.js';
import type { DrizzleDb } from '../db/db.module.js';
import {
  buildBriefNoticeResolver,
  buildBriefNoticeEnqueuer,
  buildBriefNoticeCleanup,
} from './brief-ready-email.js';

const NOW = new Date('2026-10-10T12:00:00Z'); // 8am New York, matching local schedule.
const PRIVATE = 'PRIVATE_GMAIL_CONTENT';
const payload = {
  reply: [
    {
      senderKey: 'a',
      senderName: PRIVATE,
      senderEmail: `${PRIVATE}@example.test`,
      subject: PRIVATE,
      messageIds: ['private-message'],
    },
  ],
  fyi: [],
  noise: [{ senderKey: 'b', senderName: PRIVATE, messageCount: 3, messageIds: ['m1', 'm2', 'm3'] }],
  narrative: PRIVATE,
};
const ctx: WorkerContext = {
  workerName: 'EmailSendWorker',
  jobId: 'test',
  policy: 'batchPolicy',
  attempt: 1,
  maxAttempts: 3,
  startedAt: NOW,
};
async function fixture() {
  const db = await freshTestDb();
  const [ws] = await db
    .insert(workspaces)
    .values({ name: 'Brief fixture', tier: 'pro' })
    .returning();
  const [user] = await db
    .insert(users)
    .values({
      workspaceId: ws!.id,
      email: 'owner@example.test',
      timezone: 'America/New_York',
      preferences: {
        briefPrefs: { hour: 8 },
        emailPrefs: { briefReady: true },
        emailBriefOptInRevision: 'initial',
      },
    })
    .returning();
  const [mailbox] = await db
    .insert(mailboxAccounts)
    .values({
      userId: user!.id,
      workspaceId: ws!.id,
      provider: 'gmail',
      providerAccountId: 'second@example.test',
    })
    .returning();
  await db
    .insert(providerSyncState)
    .values({ mailboxAccountId: mailbox!.id, readinessStatus: 'ready' });
  const [run] = await db
    .insert(briefRuns)
    .values({
      workspaceId: ws!.id,
      mailboxAccountId: mailbox!.id,
      runDateLocal: '2026-10-10',
      generatedBy: 'template',
      generatedAt: NOW,
      briefPayload: payload,
    })
    .returning();
  const job: EmailSendJobData = {
    kind: 'brief-ready',
    userId: user!.id,
    mailboxAccountId: mailbox!.id,
    briefRunId: run!.id,
    idempotencyKey: briefReadyEmailJobId(run!.id),
    subject: '',
    text: '',
  };
  const deliver = vi.fn().mockResolvedValue({ ok: true, providerId: 'synthetic-provider' });
  const resolver = buildBriefNoticeResolver(
    db as unknown as DrizzleDb,
    'https://declutrmail.com',
    'https://api.example.test',
    () => NOW,
  );
  const worker = new EmailSendWorker({
    db: db as never,
    queueName: BRIEF_EMAIL_SEND_QUEUE,
    resolveBriefNotice: resolver,
    delivery: { deliver },
  });
  const marker = async () =>
    (await db.select().from(briefRuns).where(eq(briefRuns.id, run!.id)))[0]?.emailSentAt ?? null;
  return {
    db,
    ws: ws!,
    user: user!,
    mailbox: mailbox!,
    run: run!,
    job,
    worker,
    resolver,
    deliver,
    marker,
  };
}

describe('Daily Brief opt-in delivery', () => {
  it.runIf(Boolean(process.env.TEST_REDIS_URL))(
    'runs scheduling through real Redis and the production send worker once',
    async () => {
      vi.stubEnv('UNSUBSCRIBE_TOKEN_SECRET', 'synthetic-secret-for-brief-testing-00000000000');
      const connection = new Redis(process.env.TEST_REDIS_URL!, { maxRetriesPerRequest: null });
      const prefix = `brief-test-${randomUUID()}`;
      const queue = new Queue<EmailSendJobData>(BRIEF_EMAIL_SEND_QUEUE, { connection, prefix });
      let consumer: Worker<EmailSendJobData> | undefined;
      try {
        const f = await fixture();
        const producer = new BriefSnapshotWorker({
          db: f.db as never,
          now: () => NOW,
          notifyBriefReady: buildBriefNoticeEnqueuer(queue),
        });
        const tick = { scheduledAtMinute: '2026-10-10T12:00' };
        await producer.processJob(tick, { ...ctx, policy: 'cronPolicy' });
        await producer.processJob(tick, { ...ctx, policy: 'cronPolicy' });
        expect(await queue.getWaitingCount()).toBe(1);
        expect(JSON.stringify((await queue.getJob(f.job.idempotencyKey))!.data)).not.toContain(
          PRIVATE,
        );
        consumer = new Worker(BRIEF_EMAIL_SEND_QUEUE, (job) => f.worker.run(job), {
          connection,
          prefix,
          autorun: false,
        });
        const completion = new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Brief queue did not complete')), 10_000);
          consumer!.once('completed', () => {
            clearTimeout(timer);
            resolve();
          });
          consumer!.once('failed', (_job, error) => {
            clearTimeout(timer);
            reject(error);
          });
          consumer!.once('error', (error) => {
            clearTimeout(timer);
            reject(error);
          });
        });
        void consumer.run().catch(() => undefined);
        await completion;
        expect(f.deliver).toHaveBeenCalledTimes(1);
        expect(await f.marker()).toEqual(NOW);
        await producer.processJob(tick, { ...ctx, policy: 'cronPolicy' });
        expect(await queue.getWaitingCount()).toBe(0);
        expect(f.deliver).toHaveBeenCalledTimes(1);
        await consumer.close();
        consumer = undefined;
        // Purge during an unavailable broker leaves a row without any DB identity.
        await f.db.delete(briefRuns).where(eq(briefRuns.id, f.run.id));
        const outage = vi
          .spyOn(queue, 'getJobs')
          .mockRejectedValueOnce(new Error('Synthetic Redis outage'));
        await expect(
          buildBriefNoticeCleanup(f.db as unknown as DrizzleDb, queue)(),
        ).rejects.toThrow('Synthetic Redis outage');
        expect(await queue.getJob(f.job.idempotencyKey)).not.toBeUndefined();
        // A new cleaner instance needs neither the deleted request nor the run row.
        for (let i = 0; i < 6; i++)
          await buildBriefNoticeCleanup(f.db as unknown as DrizzleDb, queue)();
        expect(await queue.getJob(f.job.idempotencyKey)).toBeUndefined();
        outage.mockRestore();
      } finally {
        await consumer?.close();
        await queue.obliterate({ force: true });
        await queue.close();
        await connection.quit();
        vi.unstubAllEnvs();
      }
    },
  );

  it.runIf(Boolean(process.env.TEST_REDIS_URL))(
    'cleans middle-rank orphans in multiple large states and paused jobs after restarts',
    async () => {
      const f = await fixture();
      const connection = new Redis(process.env.TEST_REDIS_URL!, { maxRetriesPerRequest: null });
      const prefix = `brief-pages-${randomUUID()}`;
      const queue = new Queue<EmailSendJobData>(BRIEF_EMAIL_SEND_QUEUE, { connection, prefix });
      const consumer = new Worker(
        BRIEF_EMAIL_SEND_QUEUE,
        async (job) => {
          if (job.data.subject === 'fail') throw new Error('Synthetic queue-state fixture');
          return { outcome: 'sent' };
        },
        { connection, prefix, autorun: false, concurrency: 20 },
      );
      try {
        const runs = await f.db
          .insert(briefRuns)
          .values(
            Array.from({ length: 600 }, (_, i) => ({
              workspaceId: f.ws.id,
              mailboxAccountId: f.mailbox.id,
              generatedBy: 'template' as const,
              runDateLocal: new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10),
            })),
          )
          .returning({ id: briefRuns.id });
        await queue.addBulk(
          runs.map((run, i) => ({
            name: 'email-send',
            data: {
              ...f.job,
              briefRunId: run.id,
              idempotencyKey: briefReadyEmailJobId(run.id),
              subject: i < 300 ? 'pass' : 'fail',
            },
            opts: { jobId: briefReadyEmailJobId(run.id) },
          })),
        );
        let finished = 0;
        const completed = new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error('Queue state fixture did not complete')),
            15_000,
          );
          const finish = () => {
            if (++finished === 600) {
              clearTimeout(timer);
              resolve();
            }
          };
          consumer.on('completed', finish);
          consumer.on('failed', finish);
          consumer.once('error', (error) => {
            clearTimeout(timer);
            reject(error);
          });
        });
        void consumer.run().catch(() => undefined);
        await completed;
        await consumer.close();
        const completeMiddle = (await queue.getJobs(['completed'], 100, 199, true))[50]!;
        const failedMiddle = (await queue.getJobs(['failed'], 100, 199, true))[50]!;
        for (const job of [completeMiddle, failedMiddle])
          await f.db.delete(briefRuns).where(eq(briefRuns.id, job.data.briefRunId!));
        const pages = vi.spyOn(queue, 'getJobs');
        for (let i = 0; i < 36; i++)
          await buildBriefNoticeCleanup(f.db as unknown as DrizzleDb, queue)();
        expect(await queue.getJob(completeMiddle.id!)).toBeUndefined();
        expect(await queue.getJob(failedMiddle.id!)).toBeUndefined();
        expect(await queue.getCompletedCount()).toBe(299);
        expect(await queue.getFailedCount()).toBe(299);
        for (const result of pages.mock.results)
          if (result.type === 'return')
            expect((await result.value).length).toBeLessThanOrEqual(100);
        await queue.pause();
        const paused = await queue.add('email-send', f.job, { jobId: f.job.idempotencyKey });
        await f.db.delete(briefRuns).where(eq(briefRuns.id, f.run.id));
        for (let i = 0; i < 6; i++)
          await buildBriefNoticeCleanup(f.db as unknown as DrizzleDb, queue)();
        expect(await queue.getJob(paused.id!)).toBeUndefined();
      } finally {
        await consumer.close();
        await queue.obliterate({ force: true });
        await queue.close();
        await connection.quit();
      }
    },
  );

  it('persists sparse opt-in through the real controller and retains prior opt-outs', async () => {
    const f = await fixture();
    await f.db
      .update(users)
      .set({
        preferences: {
          briefPrefs: { hour: 8 },
          emailPrefs: { reminders: false, syncComplete: false, weeklyReceipt: true },
        },
      })
      .where(eq(users.id, f.user.id));
    const controller = new EmailPrefsController(new UsersService(f.db as unknown as DrizzleDb));
    const principal = { userId: f.user.id } as SessionPrincipal;
    expect((await controller.patch(principal, { briefReady: true })).data.emailPrefs).toEqual({
      reminders: false,
      syncComplete: false,
      weeklyReceipt: true,
      briefReady: true,
    });
    const [row] = await f.db.select().from(users).where(eq(users.id, f.user.id));
    expect(row!.preferences).toEqual({
      briefPrefs: { hour: 8 },
      emailAllOptOutRevision: 'initial',
      emailBriefOptInRevision: 'initial',
      emailPrefs: { reminders: false, syncComplete: false, weeklyReceipt: true, briefReady: true },
    });
    expect(
      (await controller.patch(principal, { briefReady: false })).data.emailPrefs.briefReady,
    ).toBe(false);
  });

  it('orders opt-in and all-unsubscribe under the database row lock, including the compatible older API', async () => {
    vi.stubEnv('UNSUBSCRIBE_TOKEN_SECRET', 'synthetic-secret-for-brief-testing-00000000000');
    try {
      const f = await fixture();
      const db = f.db as unknown as DrizzleDb;
      const controller = new EmailPrefsController(new UsersService(db));
      const principal = { userId: f.user.id } as SessionPrincipal;
      const read = async () =>
        (await f.db.select().from(users).where(eq(users.id, f.user.id)))[0]!.preferences as Record<
          string,
          unknown
        >;
      const unsubscribe = new UnsubscribeController(db, { record: vi.fn() } as never);
      const token = await signUnsubscribeToken({ userId: f.user.id, scope: 'all' });
      await unsubscribe.unsubscribe(token);
      expect(hasBriefEmailConsent(await read())).toBe(false);
      await controller.patch(principal, { briefReady: true });
      expect(hasBriefEmailConsent(await read())).toBe(true);
      // Exact compatibility-release SQL: its older category list intentionally
      // leaves briefReady=true, but rotates the shared invalidation revision.
      await f.db
        .update(users)
        .set({
          preferences: sql`jsonb_set(${users.preferences}, '{emailPrefs}', (${users.preferences}->'emailPrefs') || '{"reminders":false,"syncComplete":false,"weeklyReceipt":false}'::jsonb) || jsonb_build_object('emailAllOptOutRevision', gen_random_uuid()::text)`,
        })
        .where(eq(users.id, f.user.id));
      expect((await read())!.emailPrefs).toMatchObject({ briefReady: true });
      expect(hasBriefEmailConsent(await read())).toBe(false);
      expect(
        await buildBriefNoticeResolver(
          db,
          'https://app.example.test',
          'https://api.example.test',
          () => NOW,
        )(f.run.id, f.mailbox.id, f.user.id),
      ).toBeNull();
      await controller.patch(principal, { reminders: true });
      expect(hasBriefEmailConsent(await read())).toBe(false);
      await controller.patch(principal, { briefReady: true });
      expect(hasBriefEmailConsent(await read())).toBe(true);
      await unsubscribe.unsubscribe(token);
      expect(hasBriefEmailConsent(await read())).toBe(false);
      await controller.patch(principal, { weeklyReceipt: true });
      expect(hasBriefEmailConsent(await read())).toBe(false);
      await controller.patch(principal, { briefReady: true });
      expect(hasBriefEmailConsent(await read())).toBe(true);
      await controller.patch(principal, { briefReady: false });
      expect(hasBriefEmailConsent(await read())).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it.each([null, 'corrupted', 123, [], {}])(
    'explicit opt-in repairs a malformed global revision (%#)',
    async (revision) => {
      const f = await fixture();
      await f.db
        .update(users)
        .set({
          preferences: {
            emailPrefs: { briefReady: true },
            emailAllOptOutRevision: revision,
            emailBriefOptInRevision: revision,
          },
        })
        .where(eq(users.id, f.user.id));
      expect(
        hasBriefEmailConsent(
          (await f.db.select().from(users).where(eq(users.id, f.user.id)))[0]!.preferences,
        ),
      ).toBe(false);
      await new UsersService(f.db as unknown as DrizzleDb).mergeEmailPrefs(f.user.id, {
        briefReady: true,
      });
      const prefs = (await f.db.select().from(users).where(eq(users.id, f.user.id)))[0]!
        .preferences;
      expect(hasBriefEmailConsent(prefs)).toBe(true);
      expect((prefs as Record<string, unknown>).emailAllOptOutRevision).toMatch(/^[0-9a-f]{8}-/);
    },
  );

  it('exports acknowledged delivery dates only, scoped to this workspace', async () => {
    vi.stubEnv('UNSUBSCRIBE_TOKEN_SECRET', 'synthetic-secret-for-brief-testing-00000000000');
    try {
      const f = await fixture();
      const exporter = new DataExportService(f.db as unknown as DrizzleDb);
      const collect = async () => {
        let text = '';
        for await (const chunk of exporter.streamJson(f.ws.id)) text += chunk;
        return JSON.parse(text).mailboxes[0].briefEmailDeliveries;
      };
      expect(await collect()).toEqual([]);
      await f.worker.processJob(f.job, ctx);
      expect(await collect()).toEqual([{ runDateLocal: '2026-10-10', sentAt: NOW.toISOString() }]);
      expect(JSON.stringify(await collect())).not.toContain(PRIVATE);
      const outsider = await fixture();
      await outsider.worker.processJob(outsider.job, ctx);
      expect(await collect()).toHaveLength(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('passes the existing frozen producer through fresh delivery, with counts only and one accepted notice', async () => {
    vi.stubEnv('UNSUBSCRIBE_TOKEN_SECRET', 'synthetic-secret-for-brief-testing-00000000000');
    try {
      const f = await fixture();
      const notify = vi.fn();
      const producer = new BriefSnapshotWorker({
        db: f.db as never,
        now: () => NOW,
        notifyBriefReady: notify,
      });
      expect(
        await producer.processJob(
          { scheduledAtMinute: '2026-10-10T12:00' },
          { ...ctx, policy: 'cronPolicy' },
        ),
      ).toMatchObject({ briefsGenerated: 0, mailboxesFailed: 0 });
      expect(notify).toHaveBeenCalledWith({
        runId: f.run.id,
        userId: f.user.id,
        mailboxAccountId: f.mailbox.id,
      });
      expect(await f.marker()).toBeNull();
      expect(
        await f.worker.processJob(
          {
            ...f.job,
            subject: PRIVATE,
            text: PRIVATE,
            html: PRIVATE,
            headers: { 'Bad-Header': PRIVATE },
          },
          ctx,
        ),
      ).toMatchObject({ outcome: 'sent' });
      const sent = f.deliver.mock.calls[0]![0];
      expect(sent.to).toBe(f.user.email);
      expect(sent.text).toContain('Reply senders: 1');
      expect(sent.text).toContain('Noise: 3 emails');
      expect(sent.text).toContain(`https://app.declutrmail.com/brief?mailbox=${f.mailbox.id}`);
      expect(sent.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
      expect(JSON.stringify(sent)).not.toContain(PRIVATE);
      expect(sent).not.toHaveProperty('html');
      expect(await f.marker()).toEqual(NOW);
      expect(await f.worker.processJob(f.job, ctx)).toMatchObject({ outcome: 'skipped_recovered' });
      expect(f.deliver).toHaveBeenCalledTimes(1);
      await producer.processJob(
        { scheduledAtMinute: '2026-10-10T13:00' },
        { ...ctx, policy: 'cronPolicy' },
      );
      expect(notify).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.each([
    'opted-out',
    'legacy-prefs',
    'downgraded',
    'disconnected',
    'not-ready',
    'purging',
    'deleting-account',
    'wrong-owner',
    'stale',
    'empty',
    'malformed',
    'before-hour',
  ] as const)('drops %s before any provider call', async (reason) => {
    const f = await fixture();
    let job = f.job;
    let clock = NOW;
    if (reason === 'opted-out' || reason === 'legacy-prefs')
      await f.db
        .update(users)
        .set({
          preferences: {
            emailPrefs: reason === 'legacy-prefs' ? { reminders: false } : { briefReady: false },
          },
        })
        .where(eq(users.id, f.user.id));
    if (reason === 'downgraded')
      await f.db.update(workspaces).set({ tier: 'plus' }).where(eq(workspaces.id, f.ws.id));
    if (reason === 'disconnected')
      await f.db
        .update(mailboxAccounts)
        .set({ status: 'disconnected' })
        .where(eq(mailboxAccounts.id, f.mailbox.id));
    if (reason === 'not-ready')
      await f.db
        .update(providerSyncState)
        .set({ readinessStatus: 'queued' })
        .where(eq(providerSyncState.mailboxAccountId, f.mailbox.id));
    if (reason === 'purging')
      await f.db.insert(mailboxDataDeletionRequests).values({ mailboxAccountId: f.mailbox.id });
    if (reason === 'deleting-account')
      await f.db
        .insert(accountDeletionRequests)
        .values({ userId: f.user.id, basis: 'flat-grace', effectiveAt: NOW });
    if (reason === 'wrong-owner') job = { ...job, userId: '00000000-0000-4000-8000-000000000099' };
    if (reason === 'stale')
      await f.db
        .update(briefRuns)
        .set({ runDateLocal: '2026-10-09' })
        .where(eq(briefRuns.id, f.run.id));
    if (reason === 'empty')
      await f.db
        .update(briefRuns)
        .set({ briefPayload: { reply: [], fyi: [], noise: [], narrative: '' } })
        .where(eq(briefRuns.id, f.run.id));
    if (reason === 'malformed')
      await f.db
        .update(briefRuns)
        .set({ briefPayload: { ...payload, noise: [{ ...payload.noise[0]!, messageCount: -1 }] } })
        .where(eq(briefRuns.id, f.run.id));
    if (reason === 'before-hour') clock = new Date('2026-10-10T11:59:59Z');
    const worker = new EmailSendWorker({
      db: f.db as never,
      queueName: BRIEF_EMAIL_SEND_QUEUE,
      resolveBriefNotice: buildBriefNoticeResolver(
        f.db as unknown as DrizzleDb,
        'https://app.declutrmail.com',
        'https://api.example.test',
        () => clock,
      ),
      delivery: { deliver: f.deliver },
    });
    expect(await worker.processJob(job, ctx)).toMatchObject({ outcome: 'skipped_recovered' });
    expect(f.deliver).not.toHaveBeenCalled();
    expect(await f.marker()).toBeNull();
  });

  it('retries a lost sent-marker confirmation with identical provider body and key', async () => {
    vi.stubEnv('UNSUBSCRIBE_TOKEN_SECRET', 'synthetic-secret-for-brief-testing-00000000000');
    try {
      const f = await fixture();
      let lostAck = true;
      const worker = new EmailSendWorker({
        db: f.db as never,
        queueName: BRIEF_EMAIL_SEND_QUEUE,
        delivery: { deliver: f.deliver },
        resolveBriefNotice: async (...args) => {
          const notice = await f.resolver(...args);
          if (!notice) return null;
          return {
            ...notice,
            markDelivered: async () => {
              if (lostAck) {
                lostAck = false;
                throw new Error('Synthetic lost ack');
              }
              await notice.markDelivered();
            },
          };
        },
      });
      await expect(worker.processJob(f.job, ctx)).rejects.toThrow('acknowledgement failed');
      expect(await f.marker()).toBeNull();
      expect(await worker.processJob(f.job, { ...ctx, attempt: 2 })).toMatchObject({
        outcome: 'sent',
      });
      expect(f.deliver.mock.calls[0]![0]).toEqual(f.deliver.mock.calls[1]![0]);
      expect(await f.marker()).toEqual(NOW);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.each(['suppressed', 'transient', 'disabled', 'permanent'] as const)(
    'never marks %s delivery as sent',
    async (reason) => {
      vi.stubEnv('UNSUBSCRIBE_TOKEN_SECRET', 'synthetic-secret-for-brief-testing-00000000000');
      try {
        const f = await fixture();
        f.deliver.mockResolvedValue({ ok: false, reason, detail: 'Synthetic outcome' });
        if (reason === 'transient')
          await expect(f.worker.processJob(f.job, ctx)).rejects.toThrow('transiently');
        else
          expect(await f.worker.processJob(f.job, ctx)).toMatchObject({
            outcome:
              reason === 'suppressed'
                ? 'skipped_suppressed'
                : reason === 'disabled'
                  ? 'skipped_delivery_disabled'
                  : 'skipped_delivery_rejected',
          });
        expect(await f.marker()).toBeNull();
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );

  it('rejects recipient override, changed key and delivery through legacy queue', async () => {
    const f = await fixture();
    await expect(
      f.worker.processJob({ ...f.job, recipientOverride: 'other@example.test' }, ctx),
    ).rejects.toThrow('owned identifiers');
    await expect(f.worker.processJob({ ...f.job, idempotencyKey: 'forged' }, ctx)).rejects.toThrow(
      'owned identifiers',
    );
    const legacy = new EmailSendWorker({
      db: f.db as never,
      delivery: { deliver: f.deliver },
      resolveBriefNotice: f.resolver,
    });
    await expect(legacy.processJob(f.job, ctx)).rejects.toThrow('isolated resolver');
    expect(f.deliver).not.toHaveBeenCalled();
  });

  it('catches up a failed enqueue for an existing frozen run without generating it twice', async () => {
    const f = await fixture();
    const notify = vi
      .fn()
      .mockRejectedValueOnce(new Error('Synthetic queue outage'))
      .mockResolvedValue(undefined);
    const producer = new BriefSnapshotWorker({
      db: f.db as never,
      now: () => NOW,
      notifyBriefReady: notify,
    });
    expect(
      await producer.processJob(
        { scheduledAtMinute: '2026-10-10T12:00' },
        { ...ctx, policy: 'cronPolicy' },
      ),
    ).toMatchObject({ briefsGenerated: 0, mailboxesFailed: 1 });
    expect(
      await producer.processJob(
        { scheduledAtMinute: '2026-10-10T13:00' },
        { ...ctx, policy: 'cronPolicy' },
      ),
    ).toMatchObject({ briefsGenerated: 0, mailboxesFailed: 0 });
    expect(notify).toHaveBeenCalledTimes(2);
    await f.db
      .update(users)
      .set({ preferences: { emailPrefs: { briefReady: false } } })
      .where(eq(users.id, f.user.id));
    await producer.processJob(
      { scheduledAtMinute: '2026-10-10T14:00' },
      { ...ctx, policy: 'cronPolicy' },
    );
    expect(notify).toHaveBeenCalledTimes(2);
    expect(
      await f.db
        .select()
        .from(briefRuns)
        .where(and(eq(briefRuns.id, f.run.id), eq(briefRuns.mailboxAccountId, f.mailbox.id))),
    ).toHaveLength(1);
  });
});
