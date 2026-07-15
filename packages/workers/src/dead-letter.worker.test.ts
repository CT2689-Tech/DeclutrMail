import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Job } from 'bullmq';
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import {
  deadLetterJobs,
  mailboxAccounts,
  mailboxDataDeletionRequests,
  schema,
  users,
  workspaces,
} from '@declutrmail/db';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { BaseDeclutrWorker } from './base-declutr-worker.js';
import {
  DEAD_LETTER_ERROR_MAX_LEN,
  DEAD_LETTER_PAYLOAD_ALLOWED_KEYS,
  DrizzleDeadLetterRecorder,
} from './dead-letter.recorder.js';
import { DeadLetterWorker, replayDeadLetterJob } from './dead-letter.worker.js';
import type { DeadLetterReplayTarget } from './dead-letter.worker.js';
import { ValidationError } from './worker-errors.js';
import type { WorkerContext } from './worker-context.js';
import type {
  BackgroundFailureContext,
  WorkerFailureContext,
  WorkerObserver,
} from './worker-observer.js';

/**
 * Dead-letter pipeline tests (D225).
 *
 * Runs the real recorder + sweep worker against an in-process PGlite
 * database with every migration applied. Asserts the full leg: a
 * terminal worker failure parks a `dead_letter_jobs` row, the sweep
 * alerts EXACTLY once per row, and the manual replay helper marks
 * `replayed_at` (and never auto-fires — D233 spirit).
 */

const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'db', 'migrations');

async function freshDb() {
  const pg = new PGlite({ extensions: { citext } });
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of sql.split('--> statement-breakpoint')) {
      const trimmed = stmt.trim();
      if (trimmed) {
        await pg.query(trimmed);
      }
    }
  }
  return drizzle(pg, { schema });
}

/** Recording observer — every call shows up in `captures` / `bgCaptures`. */
function recordingObserver(): WorkerObserver & {
  captures: Array<{ error: Error; ctx: WorkerFailureContext }>;
  bgCaptures: Array<{ error: Error; ctx: BackgroundFailureContext }>;
} {
  const captures: Array<{ error: Error; ctx: WorkerFailureContext }> = [];
  const bgCaptures: Array<{ error: Error; ctx: BackgroundFailureContext }> = [];
  return {
    captures,
    bgCaptures,
    captureFailure(error, ctx) {
      captures.push({ error, ctx });
    },
    captureBackgroundFailure(error, ctx) {
      bgCaptures.push({ error, ctx });
    },
  };
}

const FAKE_CTX: WorkerContext = {
  jobId: 'test',
  workerName: 'DeadLetterWorker',
  attempt: 1,
  maxAttempts: 1,
  startedAt: new Date(),
  policy: 'adminPolicy',
};

describe('dead-letter pipeline (D225)', () => {
  let consoleLogSpy: MockInstance<typeof console.log>;
  let consoleErrorSpy: MockInstance<typeof console.error>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  /** Every JSON line written via `console.error`, parsed. */
  function errorLines(): Array<Record<string, unknown>> {
    return consoleErrorSpy.mock.calls.map(
      (call) => JSON.parse(String(call[0])) as Record<string, unknown>,
    );
  }

  describe('terminal failure → durable row (recorder through the real base lifecycle)', () => {
    /** Minimal worker that always fails terminally on the first attempt. */
    class AlwaysFailsWorker extends BaseDeclutrWorker<{ mailboxAccountId: string }, never> {
      override readonly workerName = 'AlwaysFailsWorker';
      override readonly policy = 'batchPolicy' as const;
      override processJob(): Promise<never> {
        // ValidationError is non-retryable → terminal on attempt 1.
        return Promise.reject(new ValidationError('engineered terminal failure'));
      }
    }

    it('writes one dead_letter_jobs row with queue, jobId, payload, error', async () => {
      const db = await freshDb();
      const worker = new AlwaysFailsWorker();
      worker.setDeadLetterRecorder(new DrizzleDeadLetterRecorder({ db: db as never }));

      const job = {
        id: 'mb-42:batch-7',
        data: { mailboxAccountId: 'mb-42' },
        attemptsMade: 0,
        queueName: 'label-action',
      } as unknown as Job<{ mailboxAccountId: string }, never>;

      await expect(worker.run(job)).rejects.toThrow();

      const rows = await db.select().from(deadLetterJobs);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        queue: 'label-action',
        jobId: 'mb-42:batch-7',
        payload: { mailboxAccountId: 'mb-42' },
        replayedAt: null,
      });
      expect(rows[0]?.error).toContain('engineered terminal failure');
      expect(rows[0]?.failedAt).toBeInstanceOf(Date);
    });
  });

  describe('recorder write-boundary sanitization (D7)', () => {
    it('does not recreate a mailbox-linked row after indexed-data deletion completed', async () => {
      const db = await freshDb();
      const [workspace] = await db
        .insert(workspaces)
        .values({ name: 'Deleted mailbox fixture' })
        .returning({ id: workspaces.id });
      const [user] = await db
        .insert(users)
        .values({ workspaceId: workspace!.id, email: 'deleted-mailbox@example.test' })
        .returning({ id: users.id });
      const [mailbox] = await db
        .insert(mailboxAccounts)
        .values({
          workspaceId: workspace!.id,
          userId: user!.id,
          provider: 'gmail',
          providerAccountId: 'deleted-mailbox@gmail.test',
          status: 'disconnected',
        })
        .returning({ id: mailboxAccounts.id });
      await db.insert(mailboxDataDeletionRequests).values({
        mailboxAccountId: mailbox!.id,
        status: 'completed',
        completedAt: new Date(),
      });
      const recorder = new DrizzleDeadLetterRecorder({ db: db as never });

      await recorder.record({
        queue: 'incremental-sync',
        jobId: `stale-${mailbox!.id}`,
        payload: { mailboxAccountId: mailbox!.id, startHistoryId: '10', endHistoryId: '11' },
        error: 'stale job failed after purge',
      });

      expect(await db.select().from(deadLetterJobs)).toHaveLength(0);
    });

    it('drops non-allowlisted keys and records them under __redacted_keys', async () => {
      const db = await freshDb();
      const recorder = new DrizzleDeadLetterRecorder({ db: db as never });

      await recorder.record({
        queue: 'label-action',
        jobId: 'mb-1:batch-1',
        // A hypothetical future worker leaking message content (D7).
        payload: {
          mailboxAccountId: 'mb-1',
          snippet: 'Hi Chintan, your invoice…',
          subject: 'Your May invoice',
          body: '<html>full body</html>',
        },
        error: 'boom',
      });

      const [row] = await db.select().from(deadLetterJobs);
      expect(row?.payload).toEqual({
        mailboxAccountId: 'mb-1',
        __redacted_keys: ['body', 'snippet', 'subject'],
      });
    });

    it('a payload with only allowlisted keys survives untouched (replay-safe)', async () => {
      const db = await freshDb();
      const recorder = new DrizzleDeadLetterRecorder({ db: db as never });

      const payload = {
        mailboxAccountId: 'mb-1',
        startHistoryId: '1000',
        endHistoryId: '2000',
      };
      await recorder.record({ queue: 'incremental-sync', jobId: 'mb-1', payload, error: 'boom' });

      const [row] = await db.select().from(deadLetterJobs);
      expect(row?.payload).toEqual(payload);
    });

    it('caps the persisted error at DEAD_LETTER_ERROR_MAX_LEN', async () => {
      const db = await freshDb();
      const recorder = new DrizzleDeadLetterRecorder({ db: db as never });

      await recorder.record({
        queue: 'q',
        jobId: 'j',
        payload: {},
        error: 'x'.repeat(DEAD_LETTER_ERROR_MAX_LEN + 500),
      });

      const [row] = await db.select().from(deadLetterJobs);
      expect(row?.error).toHaveLength(DEAD_LETTER_ERROR_MAX_LEN + 1); // cap + '…'
      expect(row?.error.endsWith('…')).toBe(true);
    });

    it('locks the allowlist to the audited union of *JobData keys', () => {
      // Changing this set is a DELIBERATE act — see the doc comment on
      // DEAD_LETTER_PAYLOAD_ALLOWED_KEYS (replay contract + D7 review).
      expect([...DEAD_LETTER_PAYLOAD_ALLOWED_KEYS]).toEqual([
        'actionId',
        'endHistoryId',
        'idempotencyKey',
        'mailboxAccountId',
        'producedAtMs',
        'scheduledAtMinute',
        'senderKey',
        'startHistoryId',
        'trigger',
        'triggeredAtMs',
      ]);
    });
  });

  describe('DeadLetterWorker sweep', () => {
    it('alerts exactly once per parked row — second sweep is silent', async () => {
      const db = await freshDb();
      await db.insert(deadLetterJobs).values([
        {
          queue: 'initial-sync',
          jobId: 'mb-1',
          payload: { mailboxAccountId: 'mb-1' },
          error: 'TransientError: still 503\n    at fetchPage (...)',
        },
        {
          queue: 'label-action',
          jobId: 'mb-2:batch-1',
          payload: { mailboxAccountId: 'mb-2' },
          error: 'InvalidGrantError: refresh token revoked',
        },
      ]);

      const obs = recordingObserver();
      const worker = new DeadLetterWorker({ db: db as never, observer: obs });

      const first = await worker.processJob({ scheduledAtMinute: '2026-06-11T10:00' }, FAKE_CTX);
      expect(first.scanned).toBe(2);
      expect(first.alerted).toBe(2);
      expect(obs.bgCaptures).toHaveLength(2);
      // Sentry context carries identifying tags + a scannable title.
      expect(obs.bgCaptures[0]?.ctx.kind).toBe('dead_letter.parked');
      expect(obs.bgCaptures[0]?.ctx.tags).toMatchObject({ queue: 'initial-sync', job_id: 'mb-1' });
      expect(obs.bgCaptures[0]?.error.message).toContain('initial-sync/mb-1');
      expect(obs.bgCaptures[0]?.error.message).toContain('TransientError: still 503');
      // ...but never the stack's continuation lines (first line only).
      expect(obs.bgCaptures[0]?.error.message).not.toContain('fetchPage');
      // The structured observability event fires once per row.
      const parkedLines = errorLines().filter((l) => l.kind === 'dead_letter.parked');
      expect(parkedLines).toHaveLength(2);
      expect(parkedLines[0]).toMatchObject({ queue: 'initial-sync', jobId: 'mb-1' });

      // Second sweep: same rows, no duplicate alert (deduped by id).
      const second = await worker.processJob({ scheduledAtMinute: '2026-06-11T10:01' }, FAKE_CTX);
      expect(second.scanned).toBe(2);
      expect(second.alerted).toBe(0);
      expect(obs.bgCaptures).toHaveLength(2);
    });

    it('a row parked between sweeps alerts on the next sweep only', async () => {
      const db = await freshDb();
      await db.insert(deadLetterJobs).values({
        queue: 'initial-sync',
        jobId: 'mb-1',
        payload: {},
        error: 'first',
      });
      const obs = recordingObserver();
      const worker = new DeadLetterWorker({ db: db as never, observer: obs });

      await worker.processJob({ scheduledAtMinute: '2026-06-11T10:00' }, FAKE_CTX);
      expect(obs.bgCaptures).toHaveLength(1);

      await db.insert(deadLetterJobs).values({
        queue: 'score',
        jobId: 'mb-9:*:123',
        payload: {},
        error: 'second',
      });
      const next = await worker.processJob({ scheduledAtMinute: '2026-06-11T10:01' }, FAKE_CTX);
      expect(next.scanned).toBe(2);
      expect(next.alerted).toBe(1);
      expect(obs.bgCaptures).toHaveLength(2);
      expect(obs.bgCaptures[1]?.ctx.tags).toMatchObject({ queue: 'score' });
    });

    it('replayed rows leave the sweep (and the dedup set gets pruned)', async () => {
      const db = await freshDb();
      const [row] = await db
        .insert(deadLetterJobs)
        .values({ queue: 'initial-sync', jobId: 'mb-1', payload: {}, error: 'boom' })
        .returning({ id: deadLetterJobs.id });
      const obs = recordingObserver();
      const worker = new DeadLetterWorker({ db: db as never, observer: obs });

      await worker.processJob({ scheduledAtMinute: '2026-06-11T10:00' }, FAKE_CTX);
      expect(obs.bgCaptures).toHaveLength(1);

      const replayed = await replayDeadLetterJob(db as never, row!.id, async () => {});
      expect(replayed).toBe('replayed');

      const after = await worker.processJob({ scheduledAtMinute: '2026-06-11T10:01' }, FAKE_CTX);
      expect(after.scanned).toBe(0);
      expect(after.alerted).toBe(0);
      expect(obs.bgCaptures).toHaveLength(1);
    });

    it('a throwing observer keeps the sweep alive and retries the row next sweep', async () => {
      const db = await freshDb();
      await db.insert(deadLetterJobs).values({
        queue: 'initial-sync',
        jobId: 'mb-1',
        payload: {},
        error: 'boom',
      });
      let calls = 0;
      const flaky: WorkerObserver = {
        captureFailure() {},
        captureBackgroundFailure() {
          calls += 1;
          if (calls === 1) {
            throw new Error('Sentry transport down');
          }
        },
      };
      const worker = new DeadLetterWorker({ db: db as never, observer: flaky });

      const first = await worker.processJob({ scheduledAtMinute: '2026-06-11T10:00' }, FAKE_CTX);
      expect(first.alerted).toBe(0); // delivery failed → not marked alerted
      expect(errorLines().some((l) => l.kind === 'worker.observer_failed')).toBe(true);

      const second = await worker.processJob({ scheduledAtMinute: '2026-06-11T10:01' }, FAKE_CTX);
      expect(second.alerted).toBe(1); // at-least-once: retried and delivered
      expect(calls).toBe(2);
    });

    it('the sweep SELECT never reads payload (D7 — parked payloads stay in the table)', async () => {
      const db = await freshDb();
      await db.insert(deadLetterJobs).values({
        queue: 'initial-sync',
        jobId: 'mb-1',
        payload: { mailboxAccountId: 'mb-1' },
        error: 'boom',
      });
      const selectSpy = vi.spyOn(db, 'select');
      const worker = new DeadLetterWorker({ db: db as never, observer: recordingObserver() });

      await worker.processJob({ scheduledAtMinute: '2026-06-11T10:00' }, FAKE_CTX);

      // The worker alerts on queue/jobId/error only — payload is never
      // selected, so it cannot leak into logs or Sentry titles.
      expect(selectSpy).toHaveBeenCalled();
      for (const call of selectSpy.mock.calls) {
        expect(Object.keys((call[0] ?? {}) as Record<string, unknown>)).not.toContain('payload');
      }
      selectSpy.mockRestore();
    });

    it('idempotency key combines worker name and scheduling minute (D225)', () => {
      const worker = new DeadLetterWorker({
        db: {} as never,
        observer: recordingObserver(),
      });
      type WithProtectedKey = DeadLetterWorker & {
        getIdempotencyKey?: (payload: { scheduledAtMinute: string }) => string;
      };
      const key = (worker as WithProtectedKey).getIdempotencyKey?.({
        scheduledAtMinute: '2026-06-11T14:35',
      });
      expect(key).toBe('DeadLetterWorker:2026-06-11T14:35');
    });
  });

  describe('replayDeadLetterJob (manual only — D233 spirit)', () => {
    it('hands the parked job to the enqueue callback, then marks replayed_at', async () => {
      const db = await freshDb();
      const [row] = await db
        .insert(deadLetterJobs)
        .values({
          queue: 'label-action',
          jobId: 'mb-2:batch-1',
          payload: { mailboxAccountId: 'mb-2', verb: 'archive' },
          error: 'boom',
        })
        .returning({ id: deadLetterJobs.id });

      const enqueued: DeadLetterReplayTarget[] = [];
      const outcome = await replayDeadLetterJob(db as never, row!.id, async (target) => {
        enqueued.push(target);
      });

      expect(outcome).toBe('replayed');
      expect(enqueued).toEqual([
        {
          queue: 'label-action',
          jobId: 'mb-2:batch-1',
          payload: { mailboxAccountId: 'mb-2', verb: 'archive' },
        },
      ]);
      const [after] = await db.select().from(deadLetterJobs);
      expect(after?.replayedAt).toBeInstanceOf(Date);
    });

    it('refuses a second replay (already_replayed) without re-enqueueing', async () => {
      const db = await freshDb();
      const [row] = await db
        .insert(deadLetterJobs)
        .values({ queue: 'q', jobId: 'j', payload: {}, error: 'boom' })
        .returning({ id: deadLetterJobs.id });

      const enqueue = vi.fn(async () => {});
      expect(await replayDeadLetterJob(db as never, row!.id, enqueue)).toBe('replayed');
      expect(await replayDeadLetterJob(db as never, row!.id, enqueue)).toBe('already_replayed');
      expect(enqueue).toHaveBeenCalledTimes(1);
    });

    it('returns not_found for an unknown id and never calls enqueue', async () => {
      const db = await freshDb();
      const enqueue = vi.fn(async () => {});
      const outcome = await replayDeadLetterJob(
        db as never,
        '00000000-0000-0000-0000-000000000000',
        enqueue,
      );
      expect(outcome).toBe('not_found');
      expect(enqueue).not.toHaveBeenCalled();
    });

    it('a failed enqueue leaves the row parked (enqueue-first ordering)', async () => {
      const db = await freshDb();
      const [row] = await db
        .insert(deadLetterJobs)
        .values({ queue: 'q', jobId: 'j', payload: {}, error: 'boom' })
        .returning({ id: deadLetterJobs.id });

      await expect(
        replayDeadLetterJob(db as never, row!.id, async () => {
          throw new Error('redis down');
        }),
      ).rejects.toThrow('redis down');

      const [after] = await db.select().from(deadLetterJobs);
      expect(after?.replayedAt).toBeNull();
    });
  });
});
