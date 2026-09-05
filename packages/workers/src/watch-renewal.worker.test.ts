import {
  cronRuns,
  mailboxAccounts,
  outboxEvents,
  providerSyncState,
  users,
  workspaces,
} from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { recordMailboxSyncFailure } from './mailbox-reconnect.js';
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

const TOPIC = 'projects/p/topics/gmail-push';

async function freshDb() {
  return freshTestDb();
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
      recordBackgroundNotice: () => {},
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
    // Partial failure still records a SUCCEEDED run.
    const runs = await db.select().from(cronRuns);
    expect(runs[0]!.status).toBe('succeeded');
    // …and the revoked grant is recorded durably, which is what both
    // ends the retry loop and lights the frontend's reconnect gate.
    const [state] = await db
      .select()
      .from(providerSyncState)
      .where(eq(providerSyncState.mailboxAccountId, bad));
    expect(state!.lastIncrementalErrorCode).toBe('InvalidGrantError');
    expect(state!.lastIncrementalErrorAt).not.toBeNull();
    // Readiness must NOT flip — that column routes an onboarded user
    // back to /onboarding (see the schema docblock).
    expect(state!.readinessStatus).toBe('ready');
  });

  /**
   * The regression this whole change exists for. Before it, a revoked
   * grant was retried every tick forever — 362 InvalidGrantError events
   * in 5 days, each parking a job in the dead-letter queue an hour later
   * (Sentry DECLUTRMAIL-WEB-X / -R).
   */
  it('STOPS retrying a revoked grant: the next sweep skips it entirely', async () => {
    const db = await freshDb();
    const bad = await seedMailbox(db, { email: 'revoked@x.com' });
    const good = await seedMailbox(db, { email: 'fine@x.com' });
    const grantError = new InvalidGrantError('reconnect required');
    const { access, watchCalls } = makeWatchAccess({ [bad]: grantError });
    const captured: Error[] = [];
    const observer: WorkerObserver = {
      captureFailure: () => {},
      captureBackgroundFailure: (error) => captured.push(error),
      recordBackgroundNotice: () => {},
    };
    const worker = new WatchRenewalWorker({
      db: db as never,
      gmailWatch: access,
      topicName: TOPIC,
      observer,
    });

    const first = await worker.processJob({ scheduledAtMinute: MINUTE }, CTX);
    expect(first).toMatchObject({ eligible: 2, watched: 1, failed: 1 });

    // A LATER tick — a fresh run key, so the cron claim does not dedup it.
    const second = await worker.processJob({ scheduledAtMinute: '2026-06-11T12:00' }, CTX);

    // The revoked mailbox is gone from the eligible set: not attempted,
    // not failed, and — the point — not reported to Sentry a second time.
    expect(second).toMatchObject({ eligible: 1, watched: 1, failed: 0 });
    expect(watchCalls.filter((id) => id === bad)).toHaveLength(1);
    expect(watchCalls.filter((id) => id === good)).toHaveLength(2);
    expect(captured).toHaveLength(1);
    // A later terminal callback from incremental sync must share this incident, not notify twice.
    await recordMailboxSyncFailure(db as never, bad, 'InvalidGrantError');
    const notices = await db.select().from(outboxEvents);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ topic: 'mailbox.reconnect_required', aggregateId: bad });
  });

  it('persists and deduplicates a first revoked grant even before sync state exists', async () => {
    const db = await freshDb();
    const mailbox = await seedMailbox(db, { email: 'before-sync@x.com' });
    await db.delete(providerSyncState).where(eq(providerSyncState.mailboxAccountId, mailbox));
    await recordMailboxSyncFailure(db as never, mailbox, 'InvalidGrantError');
    await recordMailboxSyncFailure(db as never, mailbox, 'InvalidGrantError');
    const [state] = await db
      .select()
      .from(providerSyncState)
      .where(eq(providerSyncState.mailboxAccountId, mailbox));
    expect(state?.lastIncrementalErrorCode).toBe('InvalidGrantError');
    expect(await db.select().from(outboxEvents)).toHaveLength(1);
  });

  it('keeps retrying a TRANSIENT failure — only a revoked grant is permanent', async () => {
    const db = await freshDb();
    const flaky = await seedMailbox(db, { email: 'flaky@x.com' });
    const { access, watchCalls } = makeWatchAccess({ [flaky]: new Error('Gmail 503') });
    const worker = new WatchRenewalWorker({
      db: db as never,
      gmailWatch: access,
      topicName: TOPIC,
    });

    await worker.processJob({ scheduledAtMinute: MINUTE }, CTX).catch(() => {});
    await worker.processJob({ scheduledAtMinute: '2026-06-11T12:00' }, CTX).catch(() => {});

    // Attempted BOTH times — a blip must not disable a mailbox.
    expect(watchCalls.filter((id) => id === flaky)).toHaveLength(2);
    const [state] = await db
      .select()
      .from(providerSyncState)
      .where(eq(providerSyncState.mailboxAccountId, flaky));
    expect(state!.lastIncrementalErrorCode).toBeNull();
  });

  it('re-includes a mailbox once a later successful sync clears the reconnect flag', async () => {
    const db = await freshDb();
    const mailbox = await seedMailbox(db, { email: 'reconnected@x.com' });
    // Stale invalid grant, then a SUCCESSFUL sync after it — exactly the
    // shape `markQueued({freshCredentials:true})` leaves behind, and the
    // same freshness rule the frontend's reconnect gate applies.
    await db
      .update(providerSyncState)
      .set({
        lastIncrementalErrorCode: 'InvalidGrantError',
        lastIncrementalErrorAt: new Date('2026-06-10T00:00:00Z'),
        lastSyncedAt: new Date('2026-06-11T00:00:00Z'),
      })
      .where(eq(providerSyncState.mailboxAccountId, mailbox));
    const { access, watchCalls } = makeWatchAccess({});
    const worker = new WatchRenewalWorker({
      db: db as never,
      gmailWatch: access,
      topicName: TOPIC,
    });

    const result = await worker.processJob({ scheduledAtMinute: MINUTE }, CTX);

    expect(result).toMatchObject({ eligible: 1, watched: 1, failed: 0 });
    expect(watchCalls).toEqual([mailbox]);
  });

  it('pins the error name the worker, the API and the web app all key on', () => {
    // Four sites share this literal (worker eligibility, the worker's
    // recording branch, the API's markQueued clearing rule, and the web
    // app's INVALID_GRANT_CODE). If the class name ever changes, the
    // string must change with it in all four.
    expect(new InvalidGrantError('x').name).toBe('InvalidGrantError');
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
