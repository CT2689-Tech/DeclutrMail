import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import {
  actionJobs,
  automationRules,
  mailboxAccounts,
  mailboxDataDeletionRequests,
  mailMessages,
  ruleMatchLog,
  schema,
  senderPolicies,
  senders,
  users,
  workspaces,
} from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import {
  AutopilotActionWorker,
  OutboxPublisher,
  PASSTHROUGH_MAILBOX_LOCK,
  seedAutopilotPresets,
} from '@declutrmail/workers';
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
  return freshTestDb();
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

  /**
   * Pins BOTH `created_at` values.
   *
   * The first version of this test left the seeded mailbox on its `now()`
   * default and gave the preferred one a date in the past, so `created_at`
   * ASC alone already produced the expected row: deleting the preference
   * `CASE` from `resolveActiveForRequest` left all 53 mailbox/auth/user
   * tests green. The preference must be the ONLY thing that can reorder
   * these two, or the assertion proves nothing.
   */
  async function seedTwoActiveMailboxes(): Promise<{
    workspaceId: string;
    ownerId: string;
    first: string;
    preferred: string;
    disconnected: string;
  }> {
    const seeded = await seed(db);
    await db
      .update(mailboxAccounts)
      .set({ createdAt: new Date('2026-01-01T00:00:00Z') })
      .where(eq(mailboxAccounts.id, seeded.mailboxId));
    const [preferred, disconnected] = await db
      .insert(mailboxAccounts)
      .values([
        {
          workspaceId: seeded.workspaceId,
          userId: seeded.ownerId,
          provider: 'gmail',
          providerAccountId: 'preferred@gmail.com',
          status: 'active',
          // LATER than the seeded mailbox on purpose — `created_at` ASC
          // ranks this one SECOND, so only the preference can lift it.
          createdAt: new Date('2026-01-02T00:00:00Z'),
        },
        {
          workspaceId: seeded.workspaceId,
          userId: seeded.ownerId,
          provider: 'gmail',
          providerAccountId: 'disconnected@gmail.com',
          status: 'disconnected',
          createdAt: new Date('2026-01-03T00:00:00Z'),
        },
      ])
      .returning({ id: mailboxAccounts.id });
    return {
      workspaceId: seeded.workspaceId,
      ownerId: seeded.ownerId,
      first: seeded.mailboxId,
      preferred: preferred!.id,
      disconnected: disconnected!.id,
    };
  }

  it('falls back to the first active mailbox by connection order when no preference is stored', async () => {
    const ws = await seedTwoActiveMailboxes();
    await expect(
      service.resolveActiveForRequest({ workspaceId: ws.workspaceId, userId: ws.ownerId }),
    ).resolves.toEqual({ kind: 'resolved', id: ws.first });
  });

  it('lifts the stored preference above connection order', async () => {
    const ws = await seedTwoActiveMailboxes();
    await db
      .update(users)
      .set({ preferences: { activeMailboxId: ws.preferred } })
      .where(eq(users.id, ws.ownerId));
    await expect(
      service.resolveActiveForRequest({ workspaceId: ws.workspaceId, userId: ws.ownerId }),
    ).resolves.toEqual({ kind: 'resolved', id: ws.preferred });
  });

  it('ignores a preference pointing at a disconnected mailbox', async () => {
    const ws = await seedTwoActiveMailboxes();
    await db
      .update(users)
      .set({ preferences: { activeMailboxId: ws.disconnected } })
      .where(eq(users.id, ws.ownerId));
    await expect(
      service.resolveActiveForRequest({ workspaceId: ws.workspaceId, userId: ws.ownerId }),
    ).resolves.toEqual({ kind: 'resolved', id: ws.first });
  });

  it('honours an explicit request for an active mailbox', async () => {
    const ws = await seedTwoActiveMailboxes();
    await expect(
      service.resolveActiveForRequest({
        workspaceId: ws.workspaceId,
        userId: ws.ownerId,
        requestedMailboxId: ws.preferred,
      }),
    ).resolves.toEqual({ kind: 'resolved', id: ws.preferred });
  });

  it('separates a not-owned request from a workspace with nothing active', async () => {
    const ws = await seedTwoActiveMailboxes();
    // Active mailboxes exist, the requested one is not among them.
    await expect(
      service.resolveActiveForRequest({
        workspaceId: ws.workspaceId,
        userId: ws.ownerId,
        requestedMailboxId: ws.disconnected,
      }),
    ).resolves.toEqual({ kind: 'not-owned' });

    // Disconnect everything: the SAME stale header must now report
    // `none-active`, because the recovery screen is the reconnect gate.
    await db
      .update(mailboxAccounts)
      .set({ status: 'disconnected' })
      .where(eq(mailboxAccounts.workspaceId, ws.workspaceId));
    await expect(
      service.resolveActiveForRequest({
        workspaceId: ws.workspaceId,
        userId: ws.ownerId,
        requestedMailboxId: ws.first,
      }),
    ).resolves.toEqual({ kind: 'none-active' });
    await expect(
      service.resolveActiveForRequest({ workspaceId: ws.workspaceId, userId: ws.ownerId }),
    ).resolves.toEqual({ kind: 'none-active' });
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

      // `wasActive` is the prior status: only an already-active mailbox
      // may keep its synced state on connect (SyncService.markConnected).
      expect(result).toEqual({ id: mailbox!.id, wasActive: status === 'active' });
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
    // A brand-new mailbox was not active before this connect.
    expect(result.wasActive).toBe(false);
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

describe('MailboxAccountsService.getQuietHours — held Autopilot actions (D96)', () => {
  let db: Db;
  let service: MailboxAccountsService;

  const MATCHED_AT = new Date('2026-09-10T08:00:00Z');
  const INDEXED_BEFORE_MATCH = new Date('2026-09-01T00:00:00Z');
  // A resync deletes and re-inserts `senders`, so a row created after
  // the match means the match was computed from mail that is gone.
  const REINDEXED_AFTER_MATCH = new Date('2026-09-11T00:00:00Z');

  beforeEach(async () => {
    db = await freshDb();
    service = new MailboxAccountsService(
      db as never,
      {} as TokenCryptoService,
      {} as GmailWatchService,
      new EntitlementsService(db as never),
    );
  });

  /** A Plus mailbox whose Archive rule is on — the sweep may act on it. */
  async function setup() {
    const seeded = await seed(db);
    await db.update(workspaces).set({ tier: 'plus' }).where(eq(workspaces.id, seeded.workspaceId));
    await seedAutopilotPresets(db as never, seeded.mailboxId);
    const [rule] = await db
      .update(automationRules)
      .set({ enabled: true, mode: 'observe' })
      .where(
        and(
          eq(automationRules.mailboxAccountId, seeded.mailboxId),
          eq(automationRules.presetKey, 'auto_archive_low_engagement'),
        ),
      )
      .returning({ id: automationRules.id });
    return { ...seeded, ruleId: rule!.id };
  }

  /** A sender row plus an approved, not-yet-applied match on it. */
  async function approve(
    mailboxAccountId: string,
    ruleId: string,
    email: string,
    senderCreatedAt: Date,
  ) {
    const senderKey = email.padEnd(64, '0');
    const [sender] = await db
      .insert(senders)
      .values({
        mailboxAccountId,
        senderKey,
        displayName: email,
        email,
        domain: 'shop.com',
        gmailCategory: 'promotions',
        firstSeenAt: INDEXED_BEFORE_MATCH,
        lastSeenAt: INDEXED_BEFORE_MATCH,
        createdAt: senderCreatedAt,
      })
      .returning({ id: senders.id });
    const [match] = await db
      .insert(ruleMatchLog)
      .values({
        ruleId,
        mailboxAccountId,
        senderKey,
        matchedAt: MATCHED_AT,
        modeAtMatch: 'observe',
        confidence: '0.90',
        reason: 'test match',
        intentApplied: false,
        resolution: 'approved',
      })
      .returning({ id: ruleMatchLog.id });
    return { senderKey, senderId: sender!.id, matchId: match!.id };
  }

  /** One real Autopilot action sweep. The seeded senders have nothing in INBOX. */
  function sweep(mailboxAccountId: string) {
    const worker = new AutopilotActionWorker({
      db: db as never,
      gmailMutation: {
        getClient: async () => {
          throw new Error('no sender here has mail in INBOX, so Gmail is never called');
        },
      },
      outbox: new OutboxPublisher(),
      lock: PASSTHROUGH_MAILBOX_LOCK,
      enqueueUnsubExecution: async () => {
        throw new Error('no unsubscribe rule is on');
      },
    });
    return worker.processJob(
      { mailboxAccountId, triggeredAtMs: Date.now() },
      {
        jobId: 'held-count-sweep',
        workerName: 'AutopilotActionWorker',
        attempt: 1,
        maxAttempts: 1,
        startedAt: new Date(),
        policy: 'perMailboxPolicy',
      },
    );
  }

  async function heldCount(workspaceId: string, mailboxAccountId: string) {
    return (await service.getQuietHours(workspaceId, mailboxAccountId)).heldCount;
  }

  it('counts exactly the approved matches the next sweep runs', async () => {
    const m = await setup();
    await approve(m.mailboxId, m.ruleId, 'current@shop.com', INDEXED_BEFORE_MATCH);
    // The sweep never loads a match whose sender was re-indexed after it,
    // so nothing ever runs or retires it.
    const resynced = await approve(
      m.mailboxId,
      m.ruleId,
      'resynced@shop.com',
      REINDEXED_AFTER_MATCH,
    );
    // Re-indexed too, but claimed for execution first: the sweep finishes
    // a claimed action rather than stranding it.
    const claimed = await approve(m.mailboxId, m.ruleId, 'claimed@shop.com', REINDEXED_AFTER_MATCH);
    await db.insert(actionJobs).values({
      mailboxAccountId: m.mailboxId,
      verb: 'archive',
      direction: 'forward',
      selector: { type: 'sender', senderId: claimed.senderId, senderKey: claimed.senderKey },
      resolvedMessageIds: [],
      requestedCount: 0,
      status: 'queued',
      idempotencyKey: `autopilot-${claimed.matchId}`,
    });

    expect(await heldCount(m.workspaceId, m.mailboxId)).toBe(2);

    const result = await sweep(m.mailboxId);
    expect(result.labelActionsExecuted).toBe(2);
    expect(await heldCount(m.workspaceId, m.mailboxId)).toBe(0);
    const [left] = await db
      .select()
      .from(ruleMatchLog)
      .where(eq(ruleMatchLog.id, resynced.matchId));
    expect(left).toMatchObject({ resolution: 'approved', intentApplied: false });
  });

  it('leaves out a paused or disabled rule until it can run again', async () => {
    const m = await setup();
    await approve(m.mailboxId, m.ruleId, 'current@shop.com', INDEXED_BEFORE_MATCH);
    const setRule = (patch: { enabled?: boolean; mode?: 'observe' | 'paused' }) =>
      db.update(automationRules).set(patch).where(eq(automationRules.id, m.ruleId));

    await setRule({ mode: 'paused' });
    expect(await heldCount(m.workspaceId, m.mailboxId)).toBe(0);
    expect(await sweep(m.mailboxId)).toMatchObject({
      skippedRuleInactive: 1,
      labelActionsExecuted: 0,
    });

    await setRule({ mode: 'observe', enabled: false });
    expect(await heldCount(m.workspaceId, m.mailboxId)).toBe(0);
    expect(await sweep(m.mailboxId)).toMatchObject({
      skippedRuleInactive: 1,
      labelActionsExecuted: 0,
    });

    await setRule({ enabled: true });
    expect(await heldCount(m.workspaceId, m.mailboxId)).toBe(1);
    expect(await sweep(m.mailboxId)).toMatchObject({ labelActionsExecuted: 1 });
    expect(await heldCount(m.workspaceId, m.mailboxId)).toBe(0);
  });

  it('leaves out a match whose sender was Protected after approval — the sweep dismisses it', async () => {
    const m = await setup();
    const { senderKey, matchId } = await approve(
      m.mailboxId,
      m.ruleId,
      'guarded@shop.com',
      INDEXED_BEFORE_MATCH,
    );
    await db.insert(senderPolicies).values({
      mailboxAccountId: m.mailboxId,
      senderKey,
      policyType: 'keep',
      isProtected: true,
      protectionReason: 'user_defined',
      protectionSetAt: new Date(),
    });

    expect(await heldCount(m.workspaceId, m.mailboxId)).toBe(0);

    const result = await sweep(m.mailboxId);
    expect(result.skippedProtected).toBe(1);
    expect(result.labelActionsExecuted).toBe(0);
    const [row] = await db.select().from(ruleMatchLog).where(eq(ruleMatchLog.id, matchId));
    expect(row).toMatchObject({ resolution: 'dismissed', dismissReason: 'protected' });
  });

  it('leaves out an unsubscribe for a sender already unsubscribed — the sweep closes it', async () => {
    const m = await setup();
    const [unsubRule] = await db
      .update(automationRules)
      .set({ enabled: true, mode: 'observe' })
      .where(
        and(
          eq(automationRules.mailboxAccountId, m.mailboxId),
          eq(automationRules.presetKey, 'newsletter_graveyard'),
        ),
      )
      .returning({ id: automationRules.id });
    const { senderKey, matchId } = await approve(
      m.mailboxId,
      unsubRule!.id,
      'gone@news.com',
      INDEXED_BEFORE_MATCH,
    );
    // The user unsubscribed by hand while the approved action was queued.
    await db.insert(senderPolicies).values({
      mailboxAccountId: m.mailboxId,
      senderKey,
      policyType: 'unsubscribe',
    });
    // Still counted: an unsubscribe whose sender is only kept here, and
    // whose same sender key is unsubscribed in ANOTHER mailbox.
    const kept = await approve(m.mailboxId, unsubRule!.id, 'kept@news.com', INDEXED_BEFORE_MATCH);
    await db.insert(senderPolicies).values({
      mailboxAccountId: m.mailboxId,
      senderKey: kept.senderKey,
      policyType: 'keep',
    });
    const [other] = await db
      .insert(mailboxAccounts)
      .values({
        workspaceId: m.workspaceId,
        userId: m.ownerId,
        provider: 'gmail',
        providerAccountId: 'other@example.com',
      })
      .returning({ id: mailboxAccounts.id });
    await db.insert(senderPolicies).values({
      mailboxAccountId: other!.id,
      senderKey: kept.senderKey,
      policyType: 'unsubscribe',
    });

    expect(await heldCount(m.workspaceId, m.mailboxId)).toBe(1);

    const result = await sweep(m.mailboxId);
    expect(result.skippedAlreadyUnsubscribed).toBe(1);
    const [row] = await db.select().from(ruleMatchLog).where(eq(ruleMatchLog.id, matchId));
    expect(row!.intentApplied).toBe(true);
  });

  it("is not moved by another mailbox's re-indexed sender with the same key", async () => {
    const m = await setup();
    const { senderKey } = await approve(
      m.mailboxId,
      m.ruleId,
      'shared@shop.com',
      INDEXED_BEFORE_MATCH,
    );
    const [other] = await db
      .insert(mailboxAccounts)
      .values({
        workspaceId: m.workspaceId,
        userId: m.ownerId,
        provider: 'gmail',
        providerAccountId: 'second@example.com',
        connectedAt: new Date(),
      })
      .returning({ id: mailboxAccounts.id });
    await db.insert(senders).values({
      mailboxAccountId: other!.id,
      senderKey,
      displayName: 'shared@shop.com',
      email: 'shared@shop.com',
      domain: 'shop.com',
      gmailCategory: 'promotions',
      firstSeenAt: INDEXED_BEFORE_MATCH,
      lastSeenAt: INDEXED_BEFORE_MATCH,
      createdAt: REINDEXED_AFTER_MATCH,
    });

    expect(await heldCount(m.workspaceId, m.mailboxId)).toBe(1);
  });
});
