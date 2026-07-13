import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  actionJobs,
  mailboxAccounts,
  mailMessages,
  schema,
  senders,
  users,
  workspaces,
} from '@declutrmail/db';
import { inArray } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EntitlementsService } from '../common/entitlements/entitlements.service.js';
import { ActionsService } from './actions.service.js';

/**
 * Runtime proof for the Free lifetime cleanup cap against real Postgres.
 *
 * PGlite covers each writer's application ordering in actions.service.spec.ts,
 * but its single in-process connection cannot prove that SELECT ... FOR UPDATE
 * serializes requests arriving on different physical database connections.
 * CI supplies CLEANUP_TEST_PG_URL for a disposable database whose name ends in
 * `_test`; local test runs skip this file unless the same explicit URL is set.
 */

const MIGRATIONS_DIR = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'packages',
  'db',
  'migrations',
);

const pgUrl = process.env.CLEANUP_TEST_PG_URL;

type Client = ReturnType<typeof postgres>;
type Db = PostgresJsDatabase<typeof schema>;

function assertDisposableTestDatabase(url: string): void {
  const parsed = new URL(url);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  const isLoopback = ['localhost', '127.0.0.1', '::1'].includes(hostname);
  if (!isLoopback || !databaseName.endsWith('_test')) {
    throw new Error(
      'CLEANUP_TEST_PG_URL must target localhost, 127.0.0.1, or ::1 ' +
        `and a disposable database ending in "_test"; received ${hostname || '<empty>'}/${databaseName || '<empty>'}.`,
    );
  }
}

function connect(url: string): Client {
  return postgres(url, { max: 1, prepare: false, onnotice: () => {} });
}

async function resetPublicSchema(client: Client): Promise<void> {
  // Migrations qualify enum/FK targets with `public`, so schema-search-path
  // isolation is not valid here. The strict `_test` guard above makes this
  // destructive reset safe and keeps repeated local runs deterministic.
  await client.unsafe('DROP SCHEMA IF EXISTS public CASCADE');
  await client.unsafe('CREATE SCHEMA public');
}

async function applyMigrations(client: Client): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const migration = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const statement of migration.split('--> statement-breakpoint')) {
      const sql = statement.trim();
      if (sql) await client.unsafe(sql);
    }
  }
}

async function waitForWorkspaceLockContention(
  controlClient: Client,
  contenderPids: number[],
): Promise<void> {
  const placeholders = contenderPids.map((_, index) => `$${index + 1}`).join(', ');
  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    const rows = await controlClient.unsafe<Array<{ pid: number; wait_event_type: string | null }>>(
      `SELECT pid::int AS pid, wait_event_type
       FROM pg_stat_activity
       WHERE pid IN (${placeholders})`,
      contenderPids,
    );
    const lockWaiters = new Set(
      rows.filter((row) => row.wait_event_type === 'Lock').map((row) => row.pid),
    );
    if (contenderPids.every((pid) => lockWaiters.has(pid))) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(
    `Timed out waiting for contender backends ${contenderPids.join(', ')} to block on the workspace lock.`,
  );
}

function fakeQueue() {
  const jobIds = new Set<string>();
  return {
    add: async (_name: unknown, _data: unknown, options: { jobId?: string }) => {
      if (options.jobId) jobIds.add(options.jobId);
    },
    getJob: async (_jobId: string) => null,
  };
}

async function seedQuotaFixture(db: Db): Promise<{
  workspaceId: string;
  mailboxId: string;
  senderId: string;
}> {
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: 'Postgres quota race', tier: 'free' })
    .returning({ id: workspaces.id });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: workspace!.id, email: 'quota-race@declutrmail.test' })
    .returning({ id: users.id });
  const [mailbox] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId: workspace!.id,
      userId: user!.id,
      provider: 'gmail',
      providerAccountId: 'quota-race@gmail.test',
    })
    .returning({ id: mailboxAccounts.id });

  const senderKey = 'f'.repeat(64);
  const [sender] = await db
    .insert(senders)
    .values({
      mailboxAccountId: mailbox!.id,
      senderKey,
      email: 'news@quota-race.test',
      domain: 'quota-race.test',
      gmailCategory: 'promotions',
      unsubscribeMethod: 'mailto',
      unsubscribeUrl: 'mailto:unsubscribe@quota-race.test',
      firstSeenAt: new Date('2026-01-01T00:00:00.000Z'),
      lastSeenAt: new Date('2026-07-01T00:00:00.000Z'),
    })
    .returning({ id: senders.id });

  await db.insert(mailMessages).values({
    mailboxAccountId: mailbox!.id,
    providerMessageId: 'quota-race-message',
    providerThreadId: 'quota-race-thread',
    senderKey,
    internalDate: new Date('2026-07-01T00:00:00.000Z'),
    isUnread: false,
    labelIds: ['INBOX'],
  });

  for (let i = 0; i < 4; i += 1) {
    await db.insert(actionJobs).values({
      mailboxAccountId: mailbox!.id,
      verb: 'archive',
      direction: 'forward',
      selector: { type: 'sender', senderId: sender!.id, senderKey },
      requestedCount: 1,
      affectedCount: 1,
      status: 'done',
      idempotencyKey: `postgres-quota-fill-${i}`,
    });
  }

  return { workspaceId: workspace!.id, mailboxId: mailbox!.id, senderId: sender!.id };
}

describe('cleanup-cap Postgres URL guard', () => {
  it.each([
    'postgres://postgres@localhost:5432/quota_test',
    'postgres://postgres@127.0.0.1:5432/quota_test',
    'postgres://postgres@[::1]:5432/quota_test',
  ])('accepts the loopback test target %s', (url) => {
    expect(() => assertDisposableTestDatabase(url)).not.toThrow();
  });

  it.each([
    'postgres://postgres@database.example/quota_test',
    'postgres://postgres@127.0.0.1:5432/declutrmail',
  ])('rejects the unsafe target %s', (url) => {
    expect(() => assertDisposableTestDatabase(url)).toThrow(/localhost.*_test/);
  });
});

describe.skipIf(!pgUrl)('ActionsService Free cleanup cap against real Postgres', () => {
  const clients: Client[] = [];
  const databases: Db[] = [];
  let controlClient: Client | null = null;
  let databaseInitialized = false;

  beforeAll(async () => {
    assertDisposableTestDatabase(pgUrl!);

    const migrationClient = connect(pgUrl!);
    try {
      await resetPublicSchema(migrationClient);
      databaseInitialized = true;
      await applyMigrations(migrationClient);
    } finally {
      await migrationClient.end({ timeout: 5 });
    }

    for (let i = 0; i < 3; i += 1) {
      const client = connect(pgUrl!);
      clients.push(client);
      databases.push(drizzle(client, { schema }));
    }
    controlClient = connect(pgUrl!);
  });

  afterAll(async () => {
    await Promise.all([
      ...clients.map((client) => client.end({ timeout: 5 })),
      ...(controlClient ? [controlClient.end({ timeout: 5 })] : []),
    ]);
    if (!databaseInitialized) return;

    const cleanupClient = connect(pgUrl!);
    try {
      await resetPublicSchema(cleanupClient);
    } finally {
      await cleanupClient.end({ timeout: 5 });
    }
  });

  it('admits only one mixed cleanup request when one Free unit remains', async () => {
    const backendPids = await Promise.all(
      clients.map(async (client) => {
        const [row] = await client<{ pid: number }[]>`SELECT pg_backend_pid()::int AS pid`;
        return row!.pid;
      }),
    );
    expect(new Set(backendPids).size).toBe(3);

    const { workspaceId, mailboxId, senderId } = await seedQuotaFixture(databases[0]!);
    const queue = fakeQueue();
    const [legacy, composite, unsubscribe] = databases.map(
      (db) => new ActionsService(db as never, queue as never),
    );

    await controlClient!.unsafe('BEGIN');
    await controlClient!`SELECT id FROM workspaces WHERE id = ${workspaceId} FOR UPDATE`;

    const pendingResults = Promise.allSettled([
      legacy!.enqueueArchive({
        mailboxAccountId: mailboxId,
        selector: { type: 'sender', senderId },
        idempotencyKey: 'postgres-race-legacy',
        override: false,
      }),
      composite!.enqueueComposite({
        mailboxAccountId: mailboxId,
        selector: { type: 'sender', senderId },
        primary: { type: 'archive' },
        idempotencyKey: 'postgres-race-composite',
        override: false,
      }),
      unsubscribe!.recordUnsubscribeIntent({
        mailboxAccountId: mailboxId,
        senderId,
        idempotencyKey: 'postgres-race-unsubscribe',
      }),
    ]);

    let contentionFailure: unknown;
    let releaseFailure: unknown;
    try {
      await waitForWorkspaceLockContention(controlClient!, backendPids);
    } catch (error) {
      contentionFailure = error;
    } finally {
      try {
        await controlClient!.unsafe('COMMIT');
      } catch (error) {
        releaseFailure = error;
        // Closing the control session is the fail-safe lock release if
        // COMMIT itself fails. Keep awaiting the contenders afterwards.
        try {
          await controlClient!.end({ timeout: 5 });
        } catch {
          // The original COMMIT error is the actionable failure.
        }
        controlClient = null;
      }
    }

    const results = await pendingResults;
    if (contentionFailure) throw contentionFailure;
    if (releaseFailure) throw releaseFailure;

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(rejected).toHaveLength(2);
    for (const result of rejected) {
      expect(result.reason).toMatchObject({ code: 'FREE_CAP_REACHED' });
    }

    const candidateRows = await databases[0]!
      .select({ id: actionJobs.id })
      .from(actionJobs)
      .where(
        inArray(actionJobs.idempotencyKey, [
          'archive-postgres-race-legacy',
          'archive-postgres-race-composite',
          'unsub:postgres-race-unsubscribe',
        ]),
      );
    expect(candidateRows).toHaveLength(1);
    await expect(
      new EntitlementsService(databases[0]! as never).cleanupSummary(workspaceId),
    ).resolves.toEqual({ tier: 'free', limit: 5, used: 5, remaining: 0 });
  });
});
