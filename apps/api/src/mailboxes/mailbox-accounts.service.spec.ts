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
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TokenCryptoService } from '../auth/token-crypto.service.js';
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
