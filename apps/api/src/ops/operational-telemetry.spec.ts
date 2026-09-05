import { describe, expect, it, vi } from 'vitest';
import { freshTestDb } from '@declutrmail/db/testing';
import {
  cronRuns,
  mailboxAccounts,
  outboxEvents,
  providerSyncState,
  users,
  workspaces,
} from '@declutrmail/db';
import { sql } from 'drizzle-orm';
import {
  collectOperationalTelemetry,
  mailboxHealth,
  observeSyncAttempt,
  type OperationalQueue,
} from './operational-telemetry.js';

const queue = (extra: Partial<OperationalQueue> = {}): OperationalQueue => ({
  name: 'initial-sync',
  isPaused: async () => false,
  getJobCounts: async () => ({
    waiting: 0,
    paused: 0,
    prioritized: 0,
    active: 0,
    delayed: 0,
    failed: 0,
  }),
  getJobs: async () => [],
  ...extra,
});

describe('operational telemetry', () => {
  it('bounds stalled queue readiness and never starts overlapping probes after timeout', async () => {
    const brokenDb = {
      transaction: async () => {
        throw new Error('unavailable');
      },
    };
    let release!: (counts: Record<string, number>) => void;
    const counts = new Promise<Record<string, number>>((resolve) => {
      release = resolve;
    });
    const getJobCounts = vi.fn(() => counts);
    const stalled = queue({ getJobCounts });
    const emit = vi.fn();
    await collectOperationalTelemetry(brokenDb as never, [stalled], emit, new Date(), 5);
    await collectOperationalTelemetry(brokenDb as never, [stalled], emit, new Date(), 5);
    expect(getJobCounts).toHaveBeenCalledTimes(1);
    expect(
      emit.mock.calls.filter(
        ([row]) => row.kind === 'ops.collection' && row.source === 'queue' && row.success === 0,
      ),
    ).toHaveLength(2);
    expect(emit.mock.calls.some(([row]) => row.kind === 'ops.queue_health')).toBe(false);
    release({ waiting: 0, paused: 0, prioritized: 0, active: 0, delayed: 0, failed: 0 });
  });
  it('counts distinct affected mailboxes per closed reason and emits every known zero without identifiers', () => {
    const item = {
      mailboxAccountId: 'private-mailbox',
      reason: 'needs_reconnect' as const,
      errorCode: 'secret-provider-error',
      stuckSince: new Date(),
    };
    const rows = mailboxHealth([item, item]);
    expect(rows).toHaveLength(4);
    expect(rows.find((row) => row.reason === 'needs_reconnect')?.affectedMailboxes).toBe(1);
    expect(rows.filter((row) => row.affectedMailboxes === 0)).toHaveLength(3);
    expect(JSON.stringify(rows)).not.toMatch(/private-mailbox|secret-provider-error/);
  });

  it('preserves sync results and original failures even when telemetry fails', async () => {
    const emit = vi.fn();
    expect(await observeSyncAttempt('initial', async () => 42, emit)).toBe(42);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'ops.sync_attempt',
        sync: 'initial',
        outcome: 'resolved',
        durationMs: expect.any(Number),
      }),
    );
    const error = new Error('private payload');
    await expect(
      observeSyncAttempt(
        'incremental',
        async () => {
          throw error;
        },
        emit,
      ),
    ).rejects.toBe(error);
    expect(emit).toHaveBeenLastCalledWith(expect.objectContaining({ outcome: 'failure' }));
    expect(JSON.stringify(emit.mock.calls)).not.toContain('private payload');
    expect(
      await observeSyncAttempt(
        'initial',
        async () => 42,
        () => {
          throw new Error('logger unavailable');
        },
      ),
    ).toBe(42);
  });

  it('separates failed collection from empty health and preserves independent queue readings', async () => {
    const emit = vi.fn();
    const brokenDb = {
      transaction: async () => {
        throw new Error('database secret');
      },
    };
    await collectOperationalTelemetry(brokenDb as never, [queue()], emit);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'ops.collection', source: 'mailbox', success: 0 }),
    );
    expect(emit.mock.calls.some(([row]) => row.kind === 'ops.mailbox_health')).toBe(false);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'ops.queue_health', waiting: 0, oldestWaitingAgeSeconds: 0 }),
    );
    expect(JSON.stringify(emit.mock.calls)).not.toContain('database secret');
    emit.mockClear();
    await collectOperationalTelemetry(
      brokenDb as never,
      [
        queue({
          getJobCounts: async () => {
            throw new Error('Redis secret');
          },
        }),
      ],
      emit,
    );
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'ops.collection', source: 'queue', success: 0 }),
    );
    expect(emit.mock.calls.some(([row]) => row.kind === 'ops.queue_health')).toBe(false);
  });

  it('reads durable scheduler and reconnect state, retaining stale success behind a newer failure', async () => {
    const db = await freshTestDb();
    const now = new Date();
    await db.insert(cronRuns).values([
      {
        workerName: 'SnoozeWakeWorker',
        runKey: 'old-success',
        status: 'succeeded',
        startedAt: new Date(now.getTime() - 3600_000),
        finishedAt: new Date(now.getTime() - 3500_000),
      },
      {
        workerName: 'SnoozeWakeWorker',
        runKey: 'new-failure',
        status: 'failed',
        startedAt: new Date(now.getTime() - 1000),
      },
    ]);
    const [workspace] = await db.insert(workspaces).values({ name: 'test' }).returning();
    const [user] = await db
      .insert(users)
      .values({ workspaceId: workspace!.id, email: 'private@example.test' })
      .returning();
    const [mailbox] = await db
      .insert(mailboxAccounts)
      .values({
        workspaceId: workspace!.id,
        userId: user!.id,
        provider: 'gmail',
        providerAccountId: 'private-provider',
        status: 'active',
      })
      .returning();
    await db.insert(providerSyncState).values({
      mailboxAccountId: mailbox!.id,
      readinessStatus: 'ready',
      lastSyncedAt: new Date(now.getTime() - 1000),
    });
    await db.insert(outboxEvents).values({
      topic: 'mailbox.reconnect_required',
      aggregateId: mailbox!.id,
      payload: { private: true },
      status: 'dispatched',
      createdAt: new Date(now.getTime() - 60_000),
    });
    const emit = vi.fn();
    await collectOperationalTelemetry(
      db as never,
      [
        queue({
          getJobCounts: async () => ({
            waiting: 1,
            paused: 0,
            prioritized: 0,
            active: 0,
            delayed: 0,
            failed: 0,
          }),
          getJobs: async (types) =>
            types[0] === 'waiting' ? [{ timestamp: now.getTime() - 120_000 }] : [],
        }),
      ],
      emit,
      now,
    );
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'ops.scheduler_health',
        worker: 'SnoozeWakeWorker',
        status: 'failed',
        successObserved: 1,
        lastSuccessAgeSeconds: expect.any(Number),
      }),
    );
    const scheduler = emit.mock.calls.find(
      ([row]) => row.kind === 'ops.scheduler_health' && row.worker === 'SnoozeWakeWorker',
    )![0];
    expect(scheduler.lastSuccessAgeSeconds).toBeGreaterThanOrEqual(3500);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'ops.scheduler_health',
        worker: 'WorkerHeartbeat',
        observed: 0,
        successObserved: 0,
        status: 'missing',
      }),
    );
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'ops.reconnect_lifecycle',
        status: 'dispatched',
        incidents: 1,
        followedBySuccessfulSync: 1,
      }),
    );
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'ops.reconnect_lifecycle', status: 'pending', incidents: 0 }),
    );
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'ops.queue_health', oldestWaitingAgeSeconds: 120 }),
    );
    expect(JSON.stringify(emit.mock.calls)).not.toMatch(
      /private@example|private-provider|"private"/,
    );
    // A disappeared job between count and oldest-job reads must not fabricate age0.
    emit.mockClear();
    await collectOperationalTelemetry(
      db as never,
      [
        queue({
          getJobCounts: async () => ({
            waiting: 1,
            paused: 0,
            prioritized: 0,
            active: 0,
            delayed: 0,
            failed: 0,
          }),
        }),
      ],
      emit,
      now,
    );
    const backlog = emit.mock.calls.find(([row]) => row.kind === 'ops.queue_health')![0];
    expect(backlog).not.toHaveProperty('oldestWaitingAgeSeconds');
    await db.execute(sql`SELECT 1`);
  });
});
