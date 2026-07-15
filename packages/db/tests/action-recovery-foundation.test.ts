import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';

import {
  actionJobs,
  actionRecoveryPreviews,
  mailboxAccounts,
  schema,
  users,
  workspaces,
} from '../src';

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'migrations');
const VERIFIED_AT = new Date('2027-01-01T00:00:00Z');
const CONSUMED_AT = new Date('2027-01-01T00:00:01Z');
const EXPIRES_AT = new Date('2030-01-01T00:00:00Z');

async function freshDb() {
  const pg = new PGlite({ extensions: { citext } });
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((entry) => entry.endsWith('.sql'))
    .sort()) {
    const migration = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const statement of migration.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed) await pg.query(trimmed);
    }
  }
  return drizzle(pg, { schema });
}

async function seedMailbox(db: Awaited<ReturnType<typeof freshDb>>): Promise<string> {
  const [workspace] = await db.insert(workspaces).values({ name: 'Recovery WS' }).returning({
    id: workspaces.id,
  });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: workspace!.id, email: 'recovery@example.com' })
    .returning({ id: users.id });
  const [mailbox] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId: workspace!.id,
      userId: user!.id,
      provider: 'gmail',
      providerAccountId: 'recovery@example.com',
    })
    .returning({ id: mailboxAccounts.id });
  return mailbox!.id;
}

async function seedFailedRoot(
  db: Awaited<ReturnType<typeof freshDb>>,
  mailboxAccountId: string,
  key = 'recovery-root-key',
): Promise<string> {
  const [root] = await db
    .insert(actionJobs)
    .values({
      mailboxAccountId,
      verb: 'archive',
      selector: { type: 'messages' },
      resolvedMessageIds: ['message-1', 'message-2'],
      requestedCount: 2,
      status: 'failed',
      idempotencyKey: key,
      errorCode: 'GmailError',
    })
    .returning({ id: actionJobs.id });
  return root!.id;
}

function recoveryAttempt(input: {
  mailboxAccountId: string;
  rootActionId: string;
  retryOfActionId: string;
  recoveryAttempt: number;
  idempotencyKey: string;
}) {
  return {
    ...input,
    verb: 'archive' as const,
    selector: { type: 'messages' } as const,
    resolvedMessageIds: ['message-1', 'message-2'],
    requestedCount: 2,
    selectionFrozenAt: VERIFIED_AT,
  };
}

describe('action recovery foundation (migration 0039)', () => {
  it('keeps attempt 0 as the lineage root and requires complete recovery lineage', async () => {
    const db = await freshDb();
    const mailboxId = await seedMailbox(db);
    const rootId = await seedFailedRoot(db, mailboxId);

    const [root] = await db.select().from(actionJobs).where(eq(actionJobs.id, rootId));
    expect(root).toMatchObject({
      rootActionId: null,
      retryOfActionId: null,
      recoveryAttempt: 0,
      selectionFrozenAt: null,
    });

    await expect(
      db.insert(actionJobs).values({
        ...recoveryAttempt({
          mailboxAccountId: mailboxId,
          rootActionId: rootId,
          retryOfActionId: rootId,
          recoveryAttempt: 1,
          idempotencyKey: 'missing-frozen-selection',
        }),
        selectionFrozenAt: null,
      }),
    ).rejects.toThrow();
  });

  it('permits a linear chain while rejecting duplicate children and attempt numbers', async () => {
    const db = await freshDb();
    const mailboxId = await seedMailbox(db);
    const rootId = await seedFailedRoot(db, mailboxId);

    const [attemptOne] = await db
      .insert(actionJobs)
      .values(
        recoveryAttempt({
          mailboxAccountId: mailboxId,
          rootActionId: rootId,
          retryOfActionId: rootId,
          recoveryAttempt: 1,
          idempotencyKey: 'recovery-attempt-1',
        }),
      )
      .returning({ id: actionJobs.id });

    await expect(
      db.insert(actionJobs).values(
        recoveryAttempt({
          mailboxAccountId: mailboxId,
          rootActionId: rootId,
          retryOfActionId: rootId,
          recoveryAttempt: 2,
          idempotencyKey: 'duplicate-direct-child',
        }),
      ),
    ).rejects.toThrow();

    await expect(
      db.insert(actionJobs).values(
        recoveryAttempt({
          mailboxAccountId: mailboxId,
          rootActionId: rootId,
          retryOfActionId: attemptOne!.id,
          recoveryAttempt: 1,
          idempotencyKey: 'duplicate-attempt-number',
        }),
      ),
    ).rejects.toThrow();

    await expect(
      db.insert(actionJobs).values(
        recoveryAttempt({
          mailboxAccountId: mailboxId,
          rootActionId: rootId,
          retryOfActionId: attemptOne!.id,
          recoveryAttempt: 2,
          idempotencyKey: 'recovery-attempt-2',
        }),
      ),
    ).resolves.toBeDefined();
  });

  it('allows only one active preview per logical action root', async () => {
    const db = await freshDb();
    const mailboxId = await seedMailbox(db);
    const rootId = await seedFailedRoot(db, mailboxId);
    const preview = {
      mailboxAccountId: mailboxId,
      rootActionId: rootId,
      currentActionId: rootId,
      targetMessageIds: ['message-1', 'message-2'],
      expiresAt: EXPIRES_AT,
    };

    await db.insert(actionRecoveryPreviews).values(preview);
    await expect(db.insert(actionRecoveryPreviews).values(preview)).rejects.toThrow();
  });

  it('makes already-applied confirmable and requires its repair action when consumed', async () => {
    const db = await freshDb();
    const mailboxId = await seedMailbox(db);
    const rootId = await seedFailedRoot(db, mailboxId);
    const [preview] = await db
      .insert(actionRecoveryPreviews)
      .values({
        mailboxAccountId: mailboxId,
        rootActionId: rootId,
        currentActionId: rootId,
        targetMessageIds: ['message-1', 'message-2'],
        expiresAt: EXPIRES_AT,
      })
      .returning({ id: actionRecoveryPreviews.id });

    await db
      .update(actionRecoveryPreviews)
      .set({
        status: 'ready',
        outcome: 'already_applied',
        verifiedCount: 2,
        verifiedAt: VERIFIED_AT,
      })
      .where(eq(actionRecoveryPreviews.id, preview!.id));

    await expect(
      db
        .update(actionRecoveryPreviews)
        .set({ status: 'consumed', consumedAt: CONSUMED_AT })
        .where(eq(actionRecoveryPreviews.id, preview!.id)),
    ).rejects.toThrow();

    const [repairAction] = await db
      .insert(actionJobs)
      .values(
        recoveryAttempt({
          mailboxAccountId: mailboxId,
          rootActionId: rootId,
          retryOfActionId: rootId,
          recoveryAttempt: 1,
          idempotencyKey: 'already-applied-repair',
        }),
      )
      .returning({ id: actionJobs.id });

    await expect(
      db
        .update(actionRecoveryPreviews)
        .set({
          status: 'consumed',
          consumedAt: CONSUMED_AT,
          recoveryActionId: repairAction!.id,
          confirmationFingerprint: 'a'.repeat(64),
        })
        .where(eq(actionRecoveryPreviews.id, preview!.id)),
    ).resolves.toBeDefined();
  });

  it('consumes no-change-needed without manufacturing a recovery action', async () => {
    const db = await freshDb();
    const mailboxId = await seedMailbox(db);
    const rootId = await seedFailedRoot(db, mailboxId);

    await expect(
      db.insert(actionRecoveryPreviews).values({
        mailboxAccountId: mailboxId,
        rootActionId: rootId,
        currentActionId: rootId,
        status: 'consumed',
        outcome: 'no_change_needed',
        targetMessageIds: [],
        remainingMessageIds: [],
        verifiedCount: 0,
        verifiedAt: VERIFIED_AT,
        expiresAt: EXPIRES_AT,
        consumedAt: CONSUMED_AT,
      }),
    ).resolves.toBeDefined();
  });
});
