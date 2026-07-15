import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  actionJobs,
  mailboxAccounts,
  mailMessages,
  providerSyncState,
  schema,
  senders,
  users,
  workspaces,
} from '@declutrmail/db';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EntitlementsService } from '../common/entitlements/entitlements.service.js';
import { AuthSignupOrchestrator } from '../auth/auth-signup.orchestrator.js';
import { MailboxAccountsService } from '../mailboxes/mailbox-accounts.service.js';
import { SyncService } from '../sync/sync.service.js';
import { UsersService } from '../users/users.service.js';
import { ActionsService } from './actions.service.js';

/**
 * Runtime proof for workspace-scoped quota serialization against real
 * Postgres: the Free cleanup cap and connected-inbox tier limit.
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

async function seedInboxActivationFixture(db: Db): Promise<{
  workspaceId: string;
  ownerUserId: string;
  disconnectedEmail: string;
  newEmail: string;
}> {
  const disconnectedEmail = 'quota-reactivate@gmail.test';
  const newEmail = 'quota-new@gmail.test';
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: 'Postgres inbox activation race', tier: 'pro' })
    .returning({ id: workspaces.id });
  const [owner, reconnectingUser] = await db
    .insert(users)
    .values([
      { workspaceId: workspace!.id, email: 'inbox-race-owner@declutrmail.test' },
      { workspaceId: workspace!.id, email: disconnectedEmail },
    ])
    .returning({ id: users.id });
  await db.insert(mailboxAccounts).values([
    {
      workspaceId: workspace!.id,
      userId: owner!.id,
      provider: 'gmail',
      providerAccountId: 'inbox-race-primary@gmail.test',
    },
    {
      workspaceId: workspace!.id,
      userId: reconnectingUser!.id,
      provider: 'gmail',
      providerAccountId: disconnectedEmail,
      status: 'disconnected',
    },
  ]);
  return {
    workspaceId: workspace!.id,
    ownerUserId: owner!.id,
    disconnectedEmail,
    newEmail,
  };
}

function authOrchestrator(db: Db, label: string): AuthSignupOrchestrator {
  const entitlements = new EntitlementsService(db as never);
  const tokenCrypto = {
    encrypt: async () => ({
      ciphertext: Buffer.from(`ciphertext-${label}`),
      wrappedDek: Buffer.from(`dek-${label}`),
      keyVersion: 1,
    }),
  };
  const gmailWatch = { watchMailbox: async () => 'watched' };
  const queue = fakeQueue();
  const sync = new SyncService(queue as never, queue as never, db as never);
  const usersService = new UsersService(db as never);
  const mailboxes = new MailboxAccountsService(
    db as never,
    tokenCrypto as never,
    gmailWatch as never,
    entitlements,
  );
  return new AuthSignupOrchestrator(
    db as never,
    usersService,
    mailboxes,
    sync,
    gmailWatch as never,
    tokenCrypto as never,
    {
      issue: async () => ({
        tokens: { accessToken: `access-${label}`, refreshToken: `refresh-${label}` },
        sessionId: `session-${label}`,
      }),
    } as never,
    { issue: () => `csrf-${label}` } as never,
  );
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

describe.skipIf(!pgUrl)('workspace quota serialization against real Postgres', () => {
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

  it('admits only one distinct inbox activation when one Pro slot remains', async () => {
    const contenderPids = await Promise.all(
      clients.slice(1).map(async (client) => {
        const [row] = await client<{ pid: number }[]>`SELECT pg_backend_pid()::int AS pid`;
        return row!.pid;
      }),
    );
    expect(new Set(contenderPids).size).toBe(2);

    const fixture = await seedInboxActivationFixture(databases[0]!);
    const login = authOrchestrator(databases[1]!, 'login');
    const add = authOrchestrator(databases[2]!, 'add');

    // Both OAuth callbacks observed one available slot before either entered
    // the consuming transaction. These are deliberately only fast-fails.
    await Promise.all([
      new EntitlementsService(databases[1]! as never).assertCanConnectMailbox(fixture.workspaceId),
      new EntitlementsService(databases[2]! as never).assertCanConnectMailbox(fixture.workspaceId),
    ]);

    await controlClient!.unsafe('BEGIN');
    await controlClient!`SELECT id FROM workspaces WHERE id = ${fixture.workspaceId} FOR UPDATE`;

    const operations = [
      () =>
        login.connect({
          email: fixture.disconnectedEmail,
          refreshToken: 'login-refresh-token',
          ipAddress: null,
          userAgent: null,
        }),
      () =>
        add.addMailbox({
          currentUserId: fixture.ownerUserId,
          currentWorkspaceId: fixture.workspaceId,
          email: fixture.newEmail,
          refreshToken: 'add-refresh-token',
        }),
    ] as const;
    const pendingResults = Promise.allSettled(operations.map((operation) => operation()));

    let contentionFailure: unknown;
    let releaseFailure: unknown;
    try {
      await waitForWorkspaceLockContention(controlClient!, contenderPids);
    } catch (error) {
      contentionFailure = error;
    } finally {
      try {
        await controlClient!.unsafe('COMMIT');
      } catch (error) {
        releaseFailure = error;
        try {
          await controlClient!.end({ timeout: 5 });
        } catch {
          // Preserve the original COMMIT failure.
        }
        controlClient = null;
      }
    }

    const results = await pendingResults;
    if (contentionFailure) throw contentionFailure;
    if (releaseFailure) throw releaseFailure;

    const winnerIndex = results.findIndex((result) => result.status === 'fulfilled');
    expect(winnerIndex).toBeGreaterThanOrEqual(0);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const [loser] = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(loser?.reason).toMatchObject({ code: 'INBOX_LIMIT_REACHED', status: 402 });

    const activeRows = await databases[0]!
      .select({ id: mailboxAccounts.id, providerAccountId: mailboxAccounts.providerAccountId })
      .from(mailboxAccounts)
      .where(
        and(
          eq(mailboxAccounts.workspaceId, fixture.workspaceId),
          eq(mailboxAccounts.status, 'active'),
        ),
      );
    expect(activeRows).toHaveLength(2);
    expect(
      activeRows.filter((row) =>
        [fixture.disconnectedEmail, fixture.newEmail].includes(row.providerAccountId),
      ),
    ).toHaveLength(1);

    const candidateRows = await databases[0]!
      .select({ id: mailboxAccounts.id })
      .from(mailboxAccounts)
      .where(
        inArray(mailboxAccounts.providerAccountId, [fixture.disconnectedEmail, fixture.newEmail]),
      );
    const syncRows = await databases[0]!
      .select({ mailboxAccountId: providerSyncState.mailboxAccountId })
      .from(providerSyncState)
      .where(
        inArray(
          providerSyncState.mailboxAccountId,
          candidateRows.map((row) => row.id),
        ),
      );
    expect(syncRows).toHaveLength(1);

    // A duplicate callback for the winner is an active reconnect, not a new
    // slot claim, so it remains successful at capacity.
    await expect(operations[winnerIndex]!()).resolves.toBeDefined();
    const activeAfterReplay = await databases[0]!
      .select({ id: mailboxAccounts.id })
      .from(mailboxAccounts)
      .where(
        and(
          eq(mailboxAccounts.workspaceId, fixture.workspaceId),
          eq(mailboxAccounts.status, 'active'),
        ),
      );
    expect(activeAfterReplay).toHaveLength(2);
  });
});
