import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import {
  mailboxAccounts,
  mailboxDataDeletionRequests,
  mailMessages,
  schema,
  users,
  workspaces,
} from '@declutrmail/db';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DrizzleDb } from '../db/db.module.js';
import type { TokenCryptoService } from '../auth/token-crypto.service.js';
import {
  EntitlementsService,
  type EntitlementsTransaction,
} from '../common/entitlements/entitlements.service.js';
import type { GmailWatchService } from './gmail-watch.service.js';
import { MailboxAccountsService } from './mailbox-accounts.service.js';

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

type Db = ReturnType<typeof drizzle<typeof schema>>;

async function freshDb(): Promise<Db> {
  const pg = new PGlite({ extensions: { citext } });
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    const source = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const statement of source.split('--> statement-breakpoint')) {
      if (statement.trim()) await pg.query(statement.trim());
    }
  }
  return drizzle(pg, { schema });
}

async function seed(db: Db) {
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: 'Mailbox data controls' })
    .returning({ id: workspaces.id });
  const [owner, teammate] = await db
    .insert(users)
    .values([
      { workspaceId: workspace!.id, email: 'owner@declutrmail.ai' },
      { workspaceId: workspace!.id, email: 'teammate@declutrmail.ai' },
    ])
    .returning({ id: users.id });
  const [mailbox] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId: workspace!.id,
      userId: owner!.id,
      provider: 'gmail',
      providerAccountId: 'owner@gmail.com',
      encryptedRefreshToken: Buffer.from('ciphertext'),
      dekEncrypted: Buffer.from('dek'),
      keyVersion: 1,
      connectedAt: new Date(),
    })
    .returning({ id: mailboxAccounts.id });
  await db.insert(mailMessages).values({
    mailboxAccountId: mailbox!.id,
    providerMessageId: 'm1',
    providerThreadId: 't1',
    senderKey: 'sender-key',
    internalDate: new Date(),
    isUnread: true,
  });
  return {
    workspaceId: workspace!.id,
    ownerId: owner!.id,
    teammateId: teammate!.id,
    mailboxId: mailbox!.id,
  };
}

describe('MailboxAccountsService — explicit disconnect and indexed-data deletion (D245)', () => {
  let db: Db;
  let service: MailboxAccountsService;
  let watch: { stopMailbox: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    db = await freshDb();
    watch = { stopMailbox: vi.fn().mockResolvedValue(undefined) };
    service = new MailboxAccountsService(
      db as never,
      { decrypt: vi.fn().mockResolvedValue('refresh-token') } as unknown as TokenCryptoService,
      watch as unknown as GmailWatchService,
      new EntitlementsService(db as never),
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('disconnects only the owning user and retains indexed data', async () => {
    const seeded = await seed(db);

    await expect(
      service.disconnect({
        workspaceId: seeded.workspaceId,
        userId: seeded.teammateId,
        mailboxAccountId: seeded.mailboxId,
      }),
    ).rejects.toMatchObject({ status: 404 });

    const result = await service.disconnect({
      workspaceId: seeded.workspaceId,
      userId: seeded.ownerId,
      mailboxAccountId: seeded.mailboxId,
    });

    expect(result.indexedDataState).toBe('retained');
    expect(result.dataDeletion).toBeNull();
    expect(watch.stopMailbox).toHaveBeenCalledWith(seeded.mailboxId);
    expect(await db.select().from(mailMessages)).toHaveLength(1);
    const [mailbox] = await db
      .select()
      .from(mailboxAccounts)
      .where(eq(mailboxAccounts.id, seeded.mailboxId));
    expect(mailbox).toMatchObject({
      status: 'disconnected',
      encryptedRefreshToken: null,
      dekEncrypted: null,
      keyVersion: null,
    });
  });

  it('requires the mailbox-specific phrase and idempotently schedules a durable purge', async () => {
    const seeded = await seed(db);
    const input = {
      workspaceId: seeded.workspaceId,
      userId: seeded.ownerId,
      mailboxAccountId: seeded.mailboxId,
    };

    await expect(
      service.requestIndexedDataDeletion({ ...input, confirmPhrase: 'DELETE' }),
    ).rejects.toMatchObject({ code: 'MAILBOX_DATA_DELETION_CONFIRM_MISMATCH', status: 400 });

    const first = await service.requestIndexedDataDeletion({
      ...input,
      confirmPhrase: 'DELETE owner@gmail.com',
    });
    const replay = await service.requestIndexedDataDeletion({
      ...input,
      confirmPhrase: 'DELETE owner@gmail.com',
    });

    expect(first.request.status).toBe('pending');
    expect(first.mailbox.indexedDataState).toBe('deletion_pending');
    expect(replay.request.id).toBe(first.request.id);
    expect(await db.select().from(mailboxDataDeletionRequests)).toHaveLength(1);
    // The request returns before the asynchronous sweep: data is still
    // present and the UI must report queued rather than falsely claiming done.
    expect(await db.select().from(mailMessages)).toHaveLength(1);

    const [listed] = await service.listByWorkspace(seeded.workspaceId);
    expect(listed).toMatchObject({
      indexedDataState: 'deletion_pending',
      dataDeletion: { id: first.request.id, status: 'pending' },
    });
  });

  it('blocks reconnect during a purge and clears completed lifecycle state on fresh reconnect', async () => {
    const seeded = await seed(db);
    const [request] = await db
      .insert(mailboxDataDeletionRequests)
      .values({ mailboxAccountId: seeded.mailboxId, status: 'pending' })
      .returning({ id: mailboxDataDeletionRequests.id });

    const connect = () =>
      db.transaction((tx) =>
        service.upsertConnect(tx as never, {
          workspaceId: seeded.workspaceId,
          userId: seeded.ownerId,
          email: 'owner@gmail.com',
          encryptedRefreshToken: Buffer.from('new-token'),
          dekEncrypted: Buffer.from('new-dek'),
          keyVersion: 2,
        }),
      );
    await expect(connect()).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'MAILBOX_DATA_DELETION_IN_PROGRESS' }),
    });

    await db
      .update(mailboxDataDeletionRequests)
      .set({ status: 'completed', completedAt: new Date() })
      .where(eq(mailboxDataDeletionRequests.id, request!.id));
    await connect();

    expect(await db.select().from(mailboxDataDeletionRequests)).toHaveLength(0);
    const [mailbox] = await db
      .select()
      .from(mailboxAccounts)
      .where(eq(mailboxAccounts.id, seeded.mailboxId));
    expect(mailbox).toMatchObject({ status: 'active', keyVersion: 2 });
  });
});

describe('MailboxAccountsService.upsertConnect', () => {
  let pg: PGlite;
  let db: Db;
  let service: MailboxAccountsService;

  beforeAll(async () => {
    pg = new PGlite({ extensions: { citext } });
    for (const file of readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith('.sql'))
      .sort()) {
      const migration = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      for (const statement of migration.split('--> statement-breakpoint')) {
        if (statement.trim()) await pg.query(statement.trim());
      }
    }
    db = drizzle(pg, { schema });
    service = new MailboxAccountsService(
      db as unknown as DrizzleDb,
      {} as TokenCryptoService,
      {} as GmailWatchService,
      new EntitlementsService(db as never),
    );
  });

  afterAll(async () => {
    await pg.close();
  });

  async function seedOwner(
    label: string,
    tier: 'free' | 'plus' | 'pro' = 'free',
  ): Promise<{ workspaceId: string; userId: string }> {
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: `${label} workspace`, tier })
      .returning({ id: workspaces.id });
    const [user] = await db
      .insert(users)
      .values({ workspaceId: workspace!.id, email: `${label}@example.com` })
      .returning({ id: users.id });
    return { workspaceId: workspace!.id, userId: user!.id };
  }

  it('rejects a stale cross-workspace conflict without mutating the owner row', async () => {
    const owner = await seedOwner('upsert-owner');
    const challenger = await seedOwner('upsert-challenger');
    const originalCiphertext = Buffer.from('owner-ciphertext');
    const originalDek = Buffer.from('owner-dek');
    // The ownership refusal must win over this challenger's full Free slot.
    await db.insert(mailboxAccounts).values({
      workspaceId: challenger.workspaceId,
      userId: challenger.userId,
      provider: 'gmail',
      providerAccountId: 'challenger-active@example.com',
    });
    const [mailbox] = await db
      .insert(mailboxAccounts)
      .values({
        workspaceId: owner.workspaceId,
        userId: owner.userId,
        provider: 'gmail',
        providerAccountId: 'contested@example.com',
        status: 'disconnected',
        encryptedRefreshToken: originalCiphertext,
        dekEncrypted: originalDek,
        keyVersion: 1,
      })
      .returning({ id: mailboxAccounts.id });

    await expect(
      db.transaction((tx) =>
        service.upsertConnect(tx as unknown as EntitlementsTransaction, {
          workspaceId: challenger.workspaceId,
          userId: challenger.userId,
          email: '  CONTESTED@EXAMPLE.COM  ',
          encryptedRefreshToken: Buffer.from('challenger-ciphertext'),
          dekEncrypted: Buffer.from('challenger-dek'),
          keyVersion: 2,
        }),
      ),
    ).rejects.toMatchObject({
      response: { code: 'MAILBOX_OWNED_BY_OTHER_WORKSPACE' },
      status: 409,
    });

    const [persisted] = await db
      .select()
      .from(mailboxAccounts)
      .where(eq(mailboxAccounts.id, mailbox!.id));
    expect(persisted).toMatchObject({
      workspaceId: owner.workspaceId,
      userId: owner.userId,
      status: 'disconnected',
      keyVersion: 1,
    });
    expect(Buffer.from(persisted!.encryptedRefreshToken!)).toEqual(originalCiphertext);
    expect(Buffer.from(persisted!.dekEncrypted!)).toEqual(originalDek);
  });

  it.each(['active', 'disconnected'] as const)(
    'preserves a same-workspace %s reconnect',
    async (status) => {
      const owner = await seedOwner(`upsert-${status}`);
      const email = `${status}-reconnect@example.com`;
      const [mailbox] = await db
        .insert(mailboxAccounts)
        .values({
          workspaceId: owner.workspaceId,
          userId: owner.userId,
          provider: 'gmail',
          providerAccountId: email,
          status,
        })
        .returning({ id: mailboxAccounts.id });
      const freshCiphertext = Buffer.from('fresh-ciphertext');
      const freshDek = Buffer.from('fresh-dek');

      const result = await db.transaction((tx) =>
        service.upsertConnect(tx as unknown as EntitlementsTransaction, {
          workspaceId: owner.workspaceId,
          userId: owner.userId,
          email: `  ${email.toUpperCase()}  `,
          encryptedRefreshToken: freshCiphertext,
          dekEncrypted: freshDek,
          keyVersion: 7,
        }),
      );

      expect(result).toEqual({ id: mailbox!.id });
      const [persisted] = await db
        .select()
        .from(mailboxAccounts)
        .where(eq(mailboxAccounts.id, mailbox!.id));
      expect(persisted).toMatchObject({
        workspaceId: owner.workspaceId,
        userId: owner.userId,
        providerAccountId: email,
        status: 'active',
        keyVersion: 7,
      });
      expect(Buffer.from(persisted!.encryptedRefreshToken!)).toEqual(freshCiphertext);
      expect(Buffer.from(persisted!.dekEncrypted!)).toEqual(freshDek);
      expect(persisted!.connectedAt).toBeInstanceOf(Date);

      await expect(service.findByProviderEmail(`  ${email.toUpperCase()}  `)).resolves.toEqual({
        mailboxId: mailbox!.id,
        workspaceId: owner.workspaceId,
        userId: owner.userId,
        status: 'active',
      });
    },
  );

  it('stores a new provider identity in canonical trim/lower form', async () => {
    const owner = await seedOwner('canonical-new');

    const result = await db.transaction((tx) =>
      service.upsertConnect(tx as unknown as EntitlementsTransaction, {
        workspaceId: owner.workspaceId,
        userId: owner.userId,
        email: '  New.Mailbox@Example.COM  ',
        encryptedRefreshToken: Buffer.from('ciphertext'),
        dekEncrypted: Buffer.from('dek'),
        keyVersion: 1,
      }),
    );

    const [persisted] = await db
      .select({ providerAccountId: mailboxAccounts.providerAccountId })
      .from(mailboxAccounts)
      .where(eq(mailboxAccounts.id, result.id));
    expect(persisted?.providerAccountId).toBe('new.mailbox@example.com');
  });

  it('rejects a new activation when every inbox slot is already active', async () => {
    const owner = await seedOwner('at-limit-new');
    await db.insert(mailboxAccounts).values({
      workspaceId: owner.workspaceId,
      userId: owner.userId,
      provider: 'gmail',
      providerAccountId: 'already-active@example.com',
    });

    await expect(
      db.transaction((tx) =>
        service.upsertConnect(tx as unknown as EntitlementsTransaction, {
          workspaceId: owner.workspaceId,
          userId: owner.userId,
          email: 'new-at-limit@example.com',
          encryptedRefreshToken: Buffer.from('ciphertext'),
          dekEncrypted: Buffer.from('dek'),
          keyVersion: 1,
        }),
      ),
    ).rejects.toMatchObject({ code: 'INBOX_LIMIT_REACHED', status: 402 });

    await expect(service.findByProviderEmail('new-at-limit@example.com')).resolves.toBeNull();
  });

  it('leaves an at-limit disconnected mailbox inactive with its credentials unchanged', async () => {
    const owner = await seedOwner('at-limit-disconnected');
    await db.insert(mailboxAccounts).values([
      {
        workspaceId: owner.workspaceId,
        userId: owner.userId,
        provider: 'gmail',
        providerAccountId: 'active-slot@example.com',
      },
      {
        workspaceId: owner.workspaceId,
        userId: owner.userId,
        provider: 'gmail',
        providerAccountId: 'disconnected-slot@example.com',
        status: 'disconnected',
        encryptedRefreshToken: Buffer.from('old-ciphertext'),
        dekEncrypted: Buffer.from('old-dek'),
        keyVersion: 1,
      },
    ]);

    await expect(
      db.transaction((tx) =>
        service.upsertConnect(tx as unknown as EntitlementsTransaction, {
          workspaceId: owner.workspaceId,
          userId: owner.userId,
          email: 'disconnected-slot@example.com',
          encryptedRefreshToken: Buffer.from('new-ciphertext'),
          dekEncrypted: Buffer.from('new-dek'),
          keyVersion: 2,
        }),
      ),
    ).rejects.toMatchObject({ code: 'INBOX_LIMIT_REACHED' });

    await expect(service.findByProviderEmail('disconnected-slot@example.com')).resolves.toEqual(
      expect.objectContaining({ status: 'disconnected' }),
    );
    const [persisted] = await db
      .select()
      .from(mailboxAccounts)
      .where(eq(mailboxAccounts.providerAccountId, 'disconnected-slot@example.com'));
    expect(Buffer.from(persisted!.encryptedRefreshToken!)).toEqual(Buffer.from('old-ciphertext'));
    expect(persisted!.keyVersion).toBe(1);
  });

  it('refreshes an active mailbox even when a downgrade left the workspace over limit', async () => {
    const owner = await seedOwner('downgraded-active', 'plus');
    const [target] = await db
      .insert(mailboxAccounts)
      .values([
        {
          workspaceId: owner.workspaceId,
          userId: owner.userId,
          provider: 'gmail' as const,
          providerAccountId: 'downgraded-target@example.com',
        },
        {
          workspaceId: owner.workspaceId,
          userId: owner.userId,
          provider: 'gmail' as const,
          providerAccountId: 'downgraded-other@example.com',
        },
      ])
      .returning({ id: mailboxAccounts.id });

    const result = await db.transaction((tx) =>
      service.upsertConnect(tx as unknown as EntitlementsTransaction, {
        workspaceId: owner.workspaceId,
        userId: owner.userId,
        email: 'downgraded-target@example.com',
        encryptedRefreshToken: Buffer.from('fresh-ciphertext'),
        dekEncrypted: Buffer.from('fresh-dek'),
        keyVersion: 9,
      }),
    );

    expect(result.id).toBe(target!.id);
    const [persisted] = await db
      .select()
      .from(mailboxAccounts)
      .where(eq(mailboxAccounts.id, target!.id));
    expect(persisted).toMatchObject({ status: 'active', keyVersion: 9 });
  });

  it('replays the callback that consumed the final slot without consuming another', async () => {
    const owner = await seedOwner('final-slot-replay', 'pro');
    await db.insert(mailboxAccounts).values({
      workspaceId: owner.workspaceId,
      userId: owner.userId,
      provider: 'gmail',
      providerAccountId: 'replay-primary@example.com',
    });
    const connect = (keyVersion: number) =>
      db.transaction((tx) =>
        service.upsertConnect(tx as unknown as EntitlementsTransaction, {
          workspaceId: owner.workspaceId,
          userId: owner.userId,
          email: 'replay-final@example.com',
          encryptedRefreshToken: Buffer.from(`ciphertext-${keyVersion}`),
          dekEncrypted: Buffer.from(`dek-${keyVersion}`),
          keyVersion,
        }),
      );

    const first = await connect(1);
    const replay = await connect(2);

    expect(replay.id).toBe(first.id);
    await expect(service.findByProviderEmail('replay-final@example.com')).resolves.toEqual(
      expect.objectContaining({ mailboxId: first.id, status: 'active' }),
    );
    const active = await db
      .select({ id: mailboxAccounts.id })
      .from(mailboxAccounts)
      .where(
        and(
          eq(mailboxAccounts.workspaceId, owner.workspaceId),
          eq(mailboxAccounts.status, 'active'),
        ),
      );
    expect(active).toHaveLength(2);
  });
});
