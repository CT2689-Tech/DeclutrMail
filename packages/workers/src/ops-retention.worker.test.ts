import {
  cronRuns,
  deadLetterJobs,
  oauthAuthCodes,
  oauthClients,
  oauthGrants,
  oauthInteractions,
  oauthTokens,
  productEvents,
  users,
  workspaces,
} from '@declutrmail/db';
import type { schema } from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import { sql } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  OAUTH_SWEEP_MAX_PASSES,
  OpsRetentionWorker,
  RETENTION_BATCH_LIMIT,
} from './ops-retention.worker.js';
import type { WorkerContext } from './worker-context.js';

type Db = ReturnType<typeof drizzle<typeof schema>>;

const CTX: WorkerContext = { attempt: 1, jobId: 'ret-1' } as WorkerContext;
const PAYLOAD = { scheduledAtMinute: '2026-08-24T04:00' };
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

describe('OpsRetentionWorker', () => {
  let db: Db;

  const run = () => new OpsRetentionWorker({ db: db as never }).processJob(PAYLOAD, CTX);

  beforeEach(async () => {
    db = await freshTestDb();
  });

  it('deletes cron_runs past the retention window', async () => {
    await db.insert(cronRuns).values([
      { workerName: 'W1', runKey: 'W1:old', status: 'succeeded', startedAt: daysAgo(40) },
      { workerName: 'W1', runKey: 'W1:mid', status: 'succeeded', startedAt: daysAgo(35) },
      { workerName: 'W1', runKey: 'W1:new', status: 'succeeded', startedAt: daysAgo(1) },
    ]);

    const result = await run();

    expect(result.cronRunsDeleted).toBe(2);
    const left = await db.select({ k: cronRuns.runKey }).from(cronRuns);
    expect(left.map((r) => r.k)).toEqual(['W1:new']);
  });

  it('KEEPS the most recent row for a worker that has not run in months', async () => {
    // THE TRAP. `cron_runs` is both the D225 idempotency ledger AND the
    // source for the watchdog's "has this worker run recently?" check.
    // Deleting the last surviving row for a long-dead worker makes the
    // watchdog unable to distinguish "stalled 200 days ago" from "never
    // ran" — it would go silent exactly when a worker had been dead
    // longest. A plain age-based DELETE fails this test.
    await db.insert(cronRuns).values([
      { workerName: 'Abandoned', runKey: 'A:1', status: 'succeeded', startedAt: daysAgo(200) },
      { workerName: 'Abandoned', runKey: 'A:2', status: 'succeeded', startedAt: daysAgo(180) },
    ]);

    const result = await run();

    expect(result.cronRunsDeleted).toBe(1);
    const left = await db.select({ k: cronRuns.runKey }).from(cronRuns);
    expect(left.map((r) => r.k)).toEqual(['A:2']);
  });

  it('keeps the newest row for EVERY worker independently', async () => {
    // The per-group guarantee, not just a global "keep one". A single
    // `ORDER BY started_at DESC LIMIT 1` would pass the test above and
    // still wipe every other worker's last heartbeat.
    await db.insert(cronRuns).values([
      { workerName: 'A', runKey: 'A:old', status: 'succeeded', startedAt: daysAgo(90) },
      { workerName: 'A', runKey: 'A:less', status: 'succeeded', startedAt: daysAgo(80) },
      { workerName: 'B', runKey: 'B:old', status: 'succeeded', startedAt: daysAgo(70) },
      { workerName: 'B', runKey: 'B:less', status: 'succeeded', startedAt: daysAgo(60) },
    ]);

    await run();

    const left = await db.select({ k: cronRuns.runKey }).from(cronRuns);
    expect(left.map((r) => r.k).sort()).toEqual(['A:less', 'B:less']);
  });

  it('leaves everything inside the window alone', async () => {
    // Blind case in the destructive direction: if the age predicate were
    // inverted or dropped, this suite would otherwise still be green on
    // the counts above.
    await db.insert(cronRuns).values([
      { workerName: 'W', runKey: 'W:a', status: 'succeeded', startedAt: daysAgo(29) },
      { workerName: 'W', runKey: 'W:b', status: 'succeeded', startedAt: daysAgo(2) },
    ]);

    const result = await run();

    expect(result.cronRunsDeleted).toBe(0);
    expect(await db.select().from(cronRuns)).toHaveLength(2);
  });

  it('prunes dead_letter_jobs on the longer window, and only past it', async () => {
    await db.insert(deadLetterJobs).values([
      { queue: 'q', jobId: 'j1', payload: {}, error: 'e', failedAt: daysAgo(120) },
      { queue: 'q', jobId: 'j2', payload: {}, error: 'e', failedAt: daysAgo(91) },
      // 60 days old — a failure record still worth keeping. `cron_runs`
      // retention is 30 days; if the two windows were ever collapsed to
      // one constant this row would vanish and this assertion catches it.
      { queue: 'q', jobId: 'j3', payload: {}, error: 'e', failedAt: daysAgo(60) },
    ]);

    const result = await run();

    expect(result.deadLetterDeleted).toBe(2);
    const left = await db.select({ j: deadLetterJobs.jobId }).from(deadLetterJobs);
    expect(left.map((r) => r.j)).toEqual(['j3']);
  });

  it('reports the counts on the ops line, not just in the return value', async () => {
    // `worker.succeeded` filters the result through
    // `SAFE_WORKER_RESULT_KEYS`, a denylist by omission — a key absent
    // from it is dropped with no error, and every assertion above reads
    // the RETURN VALUE and would stay green. This one reads the LOG.
    await db.insert(cronRuns).values([
      { workerName: 'W', runKey: 'W:1', status: 'succeeded', startedAt: daysAgo(40) },
      { workerName: 'W', runKey: 'W:2', status: 'succeeded', startedAt: daysAgo(1) },
    ]);

    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((l: unknown) => {
      lines.push(String(l));
    });
    try {
      await new OpsRetentionWorker({ db: db as never }).run({
        id: 'ret-1',
        data: PAYLOAD,
        attemptsMade: 0,
      } as never);
    } finally {
      spy.mockRestore();
    }

    const succeeded = lines
      .map((l) => {
        try {
          return JSON.parse(l) as { kind?: string; result?: Record<string, unknown> };
        } catch {
          return null;
        }
      })
      .find((l) => l?.kind === 'worker.succeeded');
    expect(succeeded?.result).toHaveProperty('cronRunsDeleted', 1);
    expect(succeeded?.result).toHaveProperty('deadLetterDeleted');
  });

  it('deletes product_events older than 13 months and keeps a newer row', async () => {
    const [ws] = await db.insert(workspaces).values({ name: 'W', tier: 'free' }).returning();
    const [user] = await db
      .insert(users)
      .values({ workspaceId: ws!.id, email: 'ada@example.com' })
      .returning();
    await db.insert(productEvents).values([
      {
        userId: user!.id,
        event: 'signup_completed',
        props: { provider: 'google' },
        occurredAt: daysAgo(400),
      },
      {
        userId: user!.id,
        event: 'gmail_connected',
        props: { mode: 'login' },
        occurredAt: daysAgo(10),
      },
    ]);

    const result = await run();

    expect(result.productEventsDeleted).toBe(1);
    const left = await db.select({ event: productEvents.event }).from(productEvents);
    expect(left.map((row) => row.event)).toEqual(['gmail_connected']);
  });

  describe('OAuth retention (docs/spec/mcp-connector.md §7)', () => {
    const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000);

    async function seedOwner() {
      const [ws] = await db.insert(workspaces).values({ name: 'W', tier: 'free' }).returning();
      const [user] = await db
        .insert(users)
        .values({ workspaceId: ws!.id, email: 'ada@example.com' })
        .returning();
      return { workspaceId: ws!.id, userId: user!.id };
    }

    async function seedClient(
      clientId: string,
      createdAt = new Date(),
      lastGrantedAt: Date | null = null,
    ) {
      await db.insert(oauthClients).values({
        clientId,
        redirectUris: ['https://client.example/cb'],
        registrationType: 'dynamic',
        metadata: {},
        createdAt,
        lastGrantedAt,
      });
    }

    async function seedGrant(
      owner: { workspaceId: string; userId: string },
      clientId: string,
      at: { createdAt?: Date; revokedAt?: Date | null } = {},
    ) {
      const [grant] = await db
        .insert(oauthGrants)
        .values({
          ...owner,
          clientId,
          scopes: ['read'],
          resource: 'https://api.declutrmail.com/mcp',
          createdAt: at.createdAt ?? new Date(),
          revokedAt: at.revokedAt ?? null,
        })
        .returning();
      return grant!.id;
    }

    const token = (grantId: string, tokenHash: string, expiresAt: Date) => ({
      grantId,
      kind: 'refresh' as const,
      tokenHash,
      expiresAt,
      payload: {},
    });
    const code = (grantId: string, codeHash: string, expiresAt: Date) => ({
      grantId,
      codeHash,
      codeChallenge: 'c',
      codeChallengeMethod: 'S256',
      redirectUri: 'https://client.example/cb',
      expiresAt,
      payload: {},
    });

    it('removes tokens 7 days past expiry, codes 1 day past, and expired requests', async () => {
      const owner = await seedOwner();
      await seedClient('c1');
      const grantId = await seedGrant(owner, 'c1');
      await db
        .insert(oauthTokens)
        .values([
          token(grantId, 'expired-8d', daysAgo(8)),
          token(grantId, 'expired-6d', daysAgo(6)),
          token(grantId, 'live', new Date(Date.now() + 3_600_000)),
        ]);
      await db
        .insert(oauthAuthCodes)
        .values([
          code(grantId, 'expired-25h', hoursAgo(25)),
          code(grantId, 'expired-23h', hoursAgo(23)),
        ]);
      await db.insert(oauthInteractions).values([
        { idHash: 'expired', payload: {}, expiresAt: hoursAgo(1) },
        { idHash: 'pending', payload: {}, expiresAt: new Date(Date.now() + 600_000) },
      ]);

      const result = await run();

      expect(result.oauthRowsDeleted).toBe(3);
      const tokens = await db.select({ h: oauthTokens.tokenHash }).from(oauthTokens);
      expect(tokens.map((r) => r.h).sort()).toEqual(['expired-6d', 'live']);
      const codes = await db.select({ h: oauthAuthCodes.codeHash }).from(oauthAuthCodes);
      expect(codes.map((r) => r.h)).toEqual(['expired-23h']);
      const requests = await db.select({ h: oauthInteractions.idHash }).from(oauthInteractions);
      expect(requests.map((r) => r.h)).toEqual(['pending']);
    });

    it('removes a grant 30 days after it was revoked, with what it still owns', async () => {
      const owner = await seedOwner();
      await seedClient('c1');
      const old = await seedGrant(owner, 'c1', { revokedAt: daysAgo(31) });
      const recent = await seedGrant(owner, 'c1', { revokedAt: daysAgo(29) });
      await db
        .insert(oauthTokens)
        .values([
          token(old, 'old-token', new Date(Date.now() + 3_600_000)),
          token(recent, 'recent-token', new Date(Date.now() + 3_600_000)),
        ]);

      await run();

      const grants = await db.select({ id: oauthGrants.id }).from(oauthGrants);
      expect(grants.map((r) => r.id)).toEqual([recent]);
      const tokens = await db.select({ h: oauthTokens.tokenHash }).from(oauthTokens);
      expect(tokens.map((r) => r.h)).toEqual(['recent-token']);
    });

    it('retires a grant that owns nothing, and leaves a live or brand-new one alone', async () => {
      const owner = await seedOwner();
      await seedClient('c1');
      const dead = await seedGrant(owner, 'c1', { createdAt: daysAgo(40) });
      const live = await seedGrant(owner, 'c1', { createdAt: daysAgo(40) });
      const justApproved = await seedGrant(owner, 'c1');
      await db.insert(oauthTokens).values(token(live, 'live', new Date(Date.now() + 3_600_000)));

      const result = await run();

      expect(result.oauthGrantsRetired).toBe(1);
      const rows = await db
        .select({ id: oauthGrants.id, revokedAt: oauthGrants.revokedAt })
        .from(oauthGrants);
      const revoked = (id: string) => rows.find((r) => r.id === id)!.revokedAt;
      // Retired now; the 30-day rule removes it later, like any revoked grant.
      expect(revoked(dead)).toBeInstanceOf(Date);
      expect(revoked(live)).toBeNull();
      expect(revoked(justApproved)).toBeNull();
    });

    it('removes a client nobody approved after 30 days, never one with a grant', async () => {
      const owner = await seedOwner();
      await seedClient('abandoned', daysAgo(31));
      await seedClient('fresh', daysAgo(29));
      await seedClient('in-use', daysAgo(400));
      await seedGrant(owner, 'in-use');
      await db
        .insert(oauthTokens)
        .values(token((await db.select().from(oauthGrants))[0]!.id, 't', new Date(Date.now() + 1)));

      const result = await run();

      expect(result.oauthRowsDeleted).toBe(1);
      const clients = await db.select({ id: oauthClients.clientId }).from(oauthClients);
      expect(clients.map((r) => r.id).sort()).toEqual(['fresh', 'in-use']);
    });

    it('keeps a registration that was approved once, even with no grant left', async () => {
      // The app disconnected long ago and its grant is past retention —
      // but it may come back with the client id it stored, and an
      // unknown id is a dead end in the browser flow.
      const owner = await seedOwner();
      await seedClient('approved-once', daysAgo(100), daysAgo(90));
      await seedGrant(owner, 'approved-once', { createdAt: daysAgo(90), revokedAt: daysAgo(31) });
      await seedClient('never-approved', daysAgo(100));

      const result = await run();

      // The stale grant and the never-approved registration: two rows.
      expect(result.oauthRowsDeleted).toBe(2);
      expect(await db.select().from(oauthGrants)).toHaveLength(0);
      const clients = await db.select({ id: oauthClients.clientId }).from(oauthClients);
      expect(clients.map((r) => r.id)).toEqual(['approved-once']);
    });

    it('drains a backlog larger than one batch in a single run', async () => {
      // Anyone can park an authorization request, so one batch a day
      // could fall behind what a single address may write.
      await db.execute(sql`
        INSERT INTO oauth_interactions (id_hash, payload, expires_at)
        SELECT 'expired-' || n, '{}'::jsonb, now() - interval '1 hour'
        FROM generate_series(1, ${sql.raw(String(RETENTION_BATCH_LIMIT + 200))}) AS n
      `);
      await db
        .insert(oauthInteractions)
        .values({ idHash: 'pending', payload: {}, expiresAt: new Date(Date.now() + 600_000) });

      const result = await run();

      expect(result.oauthRowsDeleted).toBe(RETENTION_BATCH_LIMIT + 200);
      expect(result.moreRemaining).toBe(false);
      const left = await db.select({ h: oauthInteractions.idHash }).from(oauthInteractions);
      expect(left.map((r) => r.h)).toEqual(['pending']);
    });

    it('stops at its pass ceiling and says more remains', async () => {
      const ceiling = RETENTION_BATCH_LIMIT * OAUTH_SWEEP_MAX_PASSES;
      await db.execute(sql`
        INSERT INTO oauth_interactions (id_hash, payload, expires_at)
        SELECT 'expired-' || n, '{}'::jsonb, now() - interval '1 hour'
        FROM generate_series(1, ${sql.raw(String(ceiling + 1))}) AS n
      `);

      const result = await run();

      expect(result.oauthRowsDeleted).toBe(ceiling);
      expect(result.moreRemaining).toBe(true);
      expect(await db.select().from(oauthInteractions)).toHaveLength(1);
    }, 60_000);

    it('reports the OAuth count on the ops line', async () => {
      await seedClient('abandoned', daysAgo(31));
      const lines: string[] = [];
      const spy = vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
        lines.push(String(line));
      });
      try {
        await new OpsRetentionWorker({ db: db as never }).run({
          id: 'ret-oauth',
          data: PAYLOAD,
          attemptsMade: 0,
        } as never);
      } finally {
        spy.mockRestore();
      }
      const succeeded = lines
        .map((line) => {
          try {
            return JSON.parse(line) as { kind?: string; result?: Record<string, unknown> };
          } catch {
            return null;
          }
        })
        .find((line) => line?.kind === 'worker.succeeded');
      expect(succeeded?.result).toHaveProperty('oauthRowsDeleted', 1);
      expect(succeeded?.result).toHaveProperty('oauthGrantsRetired', 0);
    });
  });

  it('flags a backlog instead of silently truncating it', async () => {
    // A capped delete that reported nothing would look identical to a
    // clean pass while a table grew forever behind it.
    const worker = new OpsRetentionWorker({ db: db as never });
    const drained = await worker.processJob(PAYLOAD, CTX);
    expect(drained.moreRemaining).toBe(false);
  });
});
