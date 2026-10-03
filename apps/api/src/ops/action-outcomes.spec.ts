import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { actionJobs, mailboxAccounts, users, workspaces } from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import { actionOutcomeQuery, actionPendingQuery, readActionOutcomes } from './action-outcomes.js';

const now = new Date('2026-10-03T00:00:00Z');
const at = (seconds: number) => new Date(now.getTime() - seconds * 1000);

describe('durable action outcome observations', () => {
  it('binds ISO timestamps, never raw Dates, in both postgres.js queries', () => {
    for (const query of [actionOutcomeQuery(now), actionPendingQuery(now)]) {
      const params = new PgDialect().sqlToQuery(query).params;
      expect(params).toContain(now.toISOString());
      expect(params.some((param) => param instanceof Date)).toBe(false);
    }
  });

  it('counts one recovered lineage, separates Undo and protected no-ops, retains older pending, and omits private state', async () => {
    const db = await freshTestDb();
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: 'Synthetic workspace', tier: 'pro' })
      .returning();
    const [user] = await db
      .insert(users)
      .values({ workspaceId: workspace!.id, email: 'synthetic@example.test' })
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
    let sequence = 0;
    const insert = async (extra: Partial<typeof actionJobs.$inferInsert> = {}) => {
      const [row] = await db
        .insert(actionJobs)
        .values({
          mailboxAccountId: mailbox!.id,
          verb: 'archive',
          selector: { type: 'messages' },
          idempotencyKey: `private-key-${sequence++}`,
          requestedCount: 10,
          resolvedMessageIds: ['private-message'],
          createdAt: at(3600),
          updatedAt: at(3500),
          ...extra,
        })
        .returning();
      return row!;
    };
    const root = await insert({ status: 'failed', errorCode: 'TransientError' });
    await insert({
      rootActionId: root.id,
      retryOfActionId: root.id,
      recoveryAttempt: 1,
      selectionFrozenAt: at(2000),
      createdAt: at(2000),
      status: 'done',
      affectedCount: 8,
      updatedAt: at(1800),
      // Stale enqueue error must not override durable completion.
      errorCode: 'ENQUEUE_FAILED',
    });
    await insert({ status: 'done', affectedCount: 0 });
    await insert({ status: 'done', errorCode: 'LABEL_SENDER_PROTECTED' });
    await insert({ status: 'queued', updatedAt: at(3600) });
    await insert({ status: 'failed', errorCode: 'a-private-provider-error' });
    await insert({ direction: 'reverse', status: 'done', affectedCount: 8 });
    await insert({ direction: 'reverse', status: 'failed', errorCode: 'InvalidGrantError' });
    await insert({ status: 'executing', createdAt: at(90000), updatedAt: at(88000) });
    await insert({ verb: 'unsubscribe', status: 'done', affectedCount: 100 });
    const result = await readActionOutcomes(db as never, now);
    const outcome = (direction: string, value: string) =>
      result.find(
        (r) =>
          r.kind === 'ops.action_outcome' &&
          r.direction === direction &&
          r.verb === 'archive' &&
          r.outcome === value,
      )!;
    expect(outcome('forward', 'completed')).toMatchObject({
      operations: 2,
      confirmedMessages: 8,
      requestedMessages: 20,
      completedNoops: 1,
      terminalP50Seconds: 950,
      terminalP95Seconds: 1715,
    });
    expect(outcome('forward', 'failed')).toMatchObject({ operations: 1, confirmedMessages: 0 });
    expect(outcome('forward', 'protected')).toMatchObject({ operations: 1, confirmedMessages: 0 });
    expect(outcome('forward', 'queued')).toMatchObject({
      operations: 1,
      overdue: 1,
      oldestPendingSeconds: 3600,
    });
    expect(outcome('forward', 'queued')).not.toHaveProperty('terminalP50Seconds');
    expect(outcome('forward', 'executing').operations).toBe(0);
    expect(outcome('reverse', 'completed')).toMatchObject({ operations: 1, confirmedMessages: 8 });
    expect(
      result.find(
        (r) => r.kind === 'ops.action_pending' && r.direction === 'forward' && r.verb === 'archive',
      ),
    ).toMatchObject({ pending: 2, overdue: 2, oldestPendingSeconds: 90000 });
    expect(
      result.find(
        (r) =>
          r.kind === 'ops.action_failure' &&
          r.direction === 'forward' &&
          r.verb === 'archive' &&
          r.reason === 'unknown',
      )?.operations,
    ).toBe(1);
    expect(
      result.find(
        (r) =>
          r.kind === 'ops.action_failure' &&
          r.direction === 'reverse' &&
          r.verb === 'archive' &&
          r.reason === 'authorization',
      )?.operations,
    ).toBe(1);
    expect(
      result
        .filter((r) => r.kind === 'ops.action_outcome')
        .reduce((n, r) => n + Number(r.operations), 0),
    ).toBe(7);
    expect(JSON.stringify(result)).not.toMatch(
      /private|synthetic@example|unsubscribe|ENQUEUE_FAILED|InvalidGrantError/,
    );
  });

  it('emits known zeros only after a successful empty read, with no fake ages or latencies', async () => {
    const db = await freshTestDb();
    const result = await readActionOutcomes(db as never, now);
    expect(result.filter((r) => r.kind === 'ops.action_outcome')).toHaveLength(30);
    expect(result.every((r) => r.operations === undefined || r.operations === 0)).toBe(true);
    expect(result.some((r) => 'terminalP95Seconds' in r || 'oldestPendingSeconds' in r)).toBe(
      false,
    );
    await expect(
      readActionOutcomes(
        {
          execute: async () => {
            throw new Error('unavailable');
          },
        } as never,
        now,
      ),
    ).rejects.toThrow('unavailable');
  });
});
