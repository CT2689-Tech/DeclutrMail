import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { mailboxAccounts, schema, users, workspaces } from '@declutrmail/db';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
