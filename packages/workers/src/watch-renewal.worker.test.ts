import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import {
  cronRuns,
  mailboxAccounts,
  providerSyncState,
  schema,
  users,
  workspaces,
} from '@declutrmail/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';

import { GMAIL_WATCH_STATE_KEY } from './gmail-watch-state.js';
import { watchRenewalJobOptions } from './watch-renewal.queue.js';
import { WatchRenewalWorker } from './watch-renewal.worker.js';
import { InvalidGrantError } from './worker-errors.js';
import type { GmailWatchAccess, GmailWatchClient } from './ports.js';
import type { WorkerContext } from './worker-context.js';
import type { WorkerObserver } from './worker-observer.js';

/**
 * WatchRenewalWorker integration tests (D8, D225, D229).
 *
 * Runs the real worker against an in-process PGlite database with every
 * migration applied. Asserts the D225 `cron_runs` idempotency claim
 * (fresh insert / succeeded-skip / failed-takeover), the eligibility
 * predicate (active + ready + token), the per-mailbox failure isolation
 * contract, and the all-failed systemic throw.
 */

const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'db', 'migrations');
const TOPIC = 'projects/p/topics/gmail-push';

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

type Db = Awaited<ReturnType<typeof freshDb>>;

interface SeedOptions {
  email: string;
  status?: 'active' | 'disconnected';
  readiness?: 'queued' | 'syncing' | 'ready' | 'failed';
  withToken?: boolean;
}

async function seedMailbox(db: Db, opts: SeedOptions): Promise<string> {
  const [ws] = await db
    .insert(workspaces)
    .values({ name: `WS-${opts.email}` })
    .returning({ id: workspaces.id });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: ws!.id, email: opts.email })
    .returning({ id: users.id });
  const [mb] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId: ws!.id,
      userId: user!.id,
      provider: 'gmail',
      providerAccountId: opts.email,
      status: opts.status ?? 'active',
      ...(opts.withToken === false
        ? {}
        : { encryptedRefreshToken: Buffer.from('ct'), dekEncrypted: Buffer.from('dek') }),
    })
    .returning({ id: mailboxAccounts.id });
  await db.insert(providerSyncState).values({
    mailboxAccountId: mb!.id,
    readinessStatus: opts.readiness ?? 'ready',
    currentStage: opts.readiness === 'ready' || opts.readiness === undefined ? 'ready' : 'queued',
  });
  return mb!.id;
}

/** A watch access stub — per-mailbox behaviors keyed by mailbox id. */
function makeWatchAccess(
  behaviors: Record<string, 'ok' | Error>,
  fallback: 'ok' | Error = 'ok',
): { access: GmailWatchAccess; watchCalls: string[] } {
  const watchCalls: string[] = [];
  const access: GmailWatchAccess = {
    getClient: (mailboxAccountId: string): Promise<GmailWatchClient> =>
      Promise.resolve({
        watch: (topicName: string) => {
          expect(topicName).toBe(TOPIC);
          watchCalls.push(mailboxAccountId);
          const behavior = behaviors[mailboxAccountId] ?? fallback;
          if (behavior instanceof Error) {
            return Promise.reject(behavior);
          }
          return Promise.resolve({ historyId: '424242', expirationMs: 1_765_000_000_000 });
        },
        stopWatch: () => Promise.resolve(),
      }),
  };
  return { access, watchCalls };
}

const CTX: WorkerContext = {
  jobId: 'j1',
  workerName: 'WatchRenewalWorker',
  attempt: 1,
  maxAttempts: 3,
  startedAt: new Date(),
  policy: 'cronPolicy',
};

const MINUTE = '2026-06-11T06:00';

describe('WatchRenewalWorker', () => {
  it('re-watches every eligible mailbox, persists state, and records a succeeded cron_runs row', async () => {
    const db = await freshDb();
    const a = await seedMailbox(db, { email: 'a@x.com' });
    const b = await seedMailbox(db, { email: 'b@x.com' });
    const { access, watchCalls } = makeWatchAccess({});
    const worker = new WatchRenewalWorker({
      db: db as never,
      gmailWatch: access,
      topicName: TOPIC,
    });

    const result = await worker.processJob({ scheduledAtMinute: MINUTE }, CTX);

    expect(result).toMatchObject({ outcome: 'swept', eligible: 2, watched: 2, failed: 0 });
    expect(watchCalls.sort()).toEqual([a, b].sort());

    // Watch state persisted under the reserved jsonb key for both.
    for (const id of [a, b]) {
      const [row] = await db
        .select({ quietState: mailboxAccounts.quietState })
        .from(mailboxAccounts)
        .where(eq(mailboxAccounts.id, id));
      const state = (row!.quietState as Record<string, unknown>)[GMAIL_WATCH_STATE_KEY] as Record<
        string,
        unknown
      >;
      expect(state.history_id).toBe('424242');
      expect(state.expiration).toBe(new Date(1_765_000_000_000).toISOString());
    }

    // D225 idempotency ledger: one succeeded row for the run-key.
    const runs = await db.select().from(cronRuns);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      workerName: 'WatchRenewalWorker',
      runKey: `WatchRenewalWorker:${MINUTE}`,
      status: 'succeeded',
    });
    expect(runs[0]!.finishedAt).not.toBeNull();
  });

  it('skips ineligible mailboxes: disconnected, not-ready, and token-less', async () => {
    const db = await freshDb();
    const eligible = await seedMailbox(db, { email: 'ok@x.com' });
    await seedMailbox(db, { email: 'gone@x.com', status: 'disconnected' });
    await seedMailbox(db, { email: 'syncing@x.com', readiness: 'syncing' });
    await seedMailbox(db, { email: 'tokenless@x.com', withToken: false });
    const { access, watchCalls } = makeWatchAccess({});
    const worker = new WatchRenewalWorker({
      db: db as never,
      gmailWatch: access,
      topicName: TOPIC,
    });

    const result = await worker.processJob({ scheduledAtMinute: MINUTE }, CTX);

    expect(result).toMatchObject({ outcome: 'swept', eligible: 1, watched: 1 });
    expect(watchCalls).toEqual([eligible]);
  });

  it('no-ops as skipped_disabled when the topic is null: no Gmail call, no cron_runs claim', async () => {
    const db = await freshDb();
    await seedMailbox(db, { email: 'idle@x.com' });
    const { access, watchCalls } = makeWatchAccess({});
    const worker = new WatchRenewalWorker({
      db: db as never,
      gmailWatch: access,
      topicName: null,
    });

    const result = await worker.processJob({ scheduledAtMinute: MINUTE }, CTX);

    expect(result).toMatchObject({
      outcome: 'skipped_disabled',
      eligible: 0,
      watched: 0,
      failed: 0,
    });
    expect(watchCalls).toEqual([]);
    // Registered-but-idle leaves NO trace: an idle dev worker must not
    // accrete a cron_runs row every 6h.
    expect(await db.select().from(cronRuns)).toHaveLength(0);
  });

  it('ISOLATES one bad grant: records + Sentry-captures it, the rest of the sweep proceeds', async () => {
    const db = await freshDb();
    const bad = await seedMailbox(db, { email: 'revoked@x.com' });
    const good = await seedMailbox(db, { email: 'fine@x.com' });
    const grantError = new InvalidGrantError('reconnect required');
    const { access, watchCalls } = makeWatchAccess({ [bad]: grantError });
    const captured: { error: Error; kind: string }[] = [];
    const observer: WorkerObserver = {
      captureFailure: () => {},
      captureBackgroundFailure: (error, ctx) => captured.push({ error, kind: ctx.kind }),
    };
    const worker = new WatchRenewalWorker({
      db: db as never,
      gmailWatch: access,
      topicName: TOPIC,
      observer,
    });

    const result = await worker.processJob({ scheduledAtMinute: MINUTE }, CTX);

    // The sweep completed despite the bad grant — the job SUCCEEDS.
    expect(result).toMatchObject({ outcome: 'swept', eligible: 2, watched: 1, failed: 1 });
    expect(watchCalls).toContain(good);
    // Per-mailbox Sentry capture via the observer seam (D159).
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({ error: grantError, kind: 'gmail_watch.renewal_failed' });
    // Partial failure still records a SUCCEEDED run — the next 6h tick retries the bad mailbox.
    const runs = await db.select().from(cronRuns);
    expect(runs[0]!.status).toBe('succeeded');
  });

  it('throws (systemic fault) when EVERY eligible mailbox fails, recording a failed cron_runs row', async () => {
    const db = await freshDb();
    await seedMailbox(db, { email: 'a@x.com' });
    await seedMailbox(db, { email: 'b@x.com' });
    const { access } = makeWatchAccess({}, new Error('topic does not exist'));
    const worker = new WatchRenewalWorker({
      db: db as never,
      gmailWatch: access,
      topicName: TOPIC,
    });

    await expect(worker.processJob({ scheduledAtMinute: MINUTE }, CTX)).rejects.toThrow(
      /all 2 eligible mailboxes failed/,
    );
    const runs = await db.select().from(cronRuns);
    expect(runs[0]!.status).toBe('failed');
  });

  it('is a clean idempotent no-op when the run-key already SUCCEEDED', async () => {
    const db = await freshDb();
    await seedMailbox(db, { email: 'a@x.com' });
    const { access, watchCalls } = makeWatchAccess({});
    const worker = new WatchRenewalWorker({
      db: db as never,
      gmailWatch: access,
      topicName: TOPIC,
    });

    await worker.processJob({ scheduledAtMinute: MINUTE }, CTX);
    const second = await worker.processJob({ scheduledAtMinute: MINUTE }, CTX);

    expect(second).toMatchObject({ outcome: 'duplicate_run_key', watched: 0 });
    expect(watchCalls).toHaveLength(1); // No second Gmail call for the same run-key.
    expect(await db.select().from(cronRuns)).toHaveLength(1);
  });

  it('a DIFFERENT minute within the window re-watches cleanly (Gmail watch is extend-idempotent)', async () => {
    const db = await freshDb();
    await seedMailbox(db, { email: 'a@x.com' });
    const { access, watchCalls } = makeWatchAccess({});
    const worker = new WatchRenewalWorker({
      db: db as never,
      gmailWatch: access,
      topicName: TOPIC,
    });

    await worker.processJob({ scheduledAtMinute: MINUTE }, CTX);
    const second = await worker.processJob({ scheduledAtMinute: '2026-06-11T06:01' }, CTX);

    expect(second).toMatchObject({ outcome: 'swept', watched: 1 });
    expect(watchCalls).toHaveLength(2);
    expect(await db.select().from(cronRuns)).toHaveLength(2);
  });

  it('RETRIES take a failed run-key back over instead of skipping', async () => {
    const db = await freshDb();
    await seedMailbox(db, { email: 'a@x.com' });
    // Attempt 1: systemic failure → cron_runs row flips to 'failed'.
    const failing = makeWatchAccess({}, new Error('gmail 500'));
    const worker1 = new WatchRenewalWorker({
      db: db as never,
      gmailWatch: failing.access,
      topicName: TOPIC,
    });
    await expect(worker1.processJob({ scheduledAtMinute: MINUTE }, CTX)).rejects.toThrow();

    // Attempt 2 (BullMQ retry, same minute): must re-claim and succeed.
    const healthy = makeWatchAccess({});
    const worker2 = new WatchRenewalWorker({
      db: db as never,
      gmailWatch: healthy.access,
      topicName: TOPIC,
    });
    const result = await worker2.processJob({ scheduledAtMinute: MINUTE }, { ...CTX, attempt: 2 });

    expect(result).toMatchObject({ outcome: 'swept', watched: 1 });
    const runs = await db.select().from(cronRuns);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe('succeeded');
  });

  it('declares cronPolicy and the D225 (worker, minute) idempotency key', () => {
    const worker = new WatchRenewalWorker({
      db: null as never,
      gmailWatch: { getClient: () => Promise.reject(new Error('unused')) },
      topicName: TOPIC,
    });
    expect(worker.policy).toBe('cronPolicy');
    expect(
      (
        worker as unknown as { getIdempotencyKey(p: { scheduledAtMinute: string }): string }
      ).getIdempotencyKey({ scheduledAtMinute: MINUTE }),
    ).toBe(`WatchRenewalWorker:${MINUTE}`);
  });

  it('builds minute-keyed BullMQ job options (queue-level dedup layer)', () => {
    const opts = watchRenewalJobOptions(MINUTE);
    expect(opts.jobId).toBe(`WatchRenewalWorker:${MINUTE}`);
    expect(opts.attempts).toBe(3); // cronPolicy.maxAttempts
    expect(opts.removeOnFail).toBe(false);
  });
});
