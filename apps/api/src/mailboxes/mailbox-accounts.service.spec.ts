import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { mailboxAccounts, schema, users, workspaces } from '@declutrmail/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DrizzleDb } from '../db/db.module.js';
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
    );
  });

  afterAll(async () => {
    await pg.close();
  });

  async function seedOwner(label: string): Promise<{ workspaceId: string; userId: string }> {
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: `${label} workspace` })
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
        service.upsertConnect(tx as unknown as DrizzleDb, {
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
        service.upsertConnect(tx as unknown as DrizzleDb, {
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
      });
    },
  );

  it('stores a new provider identity in canonical trim/lower form', async () => {
    const owner = await seedOwner('canonical-new');

    const result = await db.transaction((tx) =>
      service.upsertConnect(tx as unknown as DrizzleDb, {
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
});
