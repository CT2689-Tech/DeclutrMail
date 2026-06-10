import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import {
  mailboxAccounts,
  schema,
  senderPolicies,
  senders,
  users,
  workspaces,
} from '@declutrmail/db';
import { TOPICS } from '@declutrmail/events';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { buildOutboxConsumer } from './outbox-consumer-router.js';
import type { DrizzleDb } from '../db/db.module.js';

/**
 * OutboxConsumerRouter spec (D204).
 *
 * Exercises the senders projection handler for the
 * `actions.unsubscribe_intent_recorded` topic against a real PGlite
 * database, mirroring the actions.service.spec pattern.
 */

const MIG_DIR = join(__dirname, '../../../../packages/db/migrations');

async function freshDb(): Promise<DrizzleDb> {
  const pg = new PGlite({ extensions: { citext } });
  const db = drizzle(pg, { schema }) as unknown as PgliteDatabase<typeof schema>;
  const files = readdirSync(MIG_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    await pg.exec(readFileSync(join(MIG_DIR, file), 'utf8'));
  }
  return db as unknown as DrizzleDb;
}

const SENDER_KEY_A = 'a'.repeat(64);

describe('OutboxConsumerRouter — D204 senders projection', () => {
  let db: DrizzleDb;
  let mailboxId: string;
  let consume: ReturnType<typeof buildOutboxConsumer>;

  beforeEach(async () => {
    db = await freshDb();
    const [w] = await db.insert(workspaces).values({ name: 'W' }).returning({ id: workspaces.id });
    const [u] = await db
      .insert(users)
      .values({ workspaceId: w!.id, email: 'u@x.com' })
      .returning({ id: users.id });
    const [m] = await db
      .insert(mailboxAccounts)
      .values({
        workspaceId: w!.id,
        userId: u!.id,
        provider: 'gmail',
        providerAccountId: 'u@x',
      })
      .returning({ id: mailboxAccounts.id });
    mailboxId = m!.id;
    await db.insert(senders).values({
      mailboxAccountId: mailboxId,
      senderKey: SENDER_KEY_A,
      email: 'spam@x.com',
      domain: 'x.com',
      gmailCategory: 'updates',
      firstSeenAt: new Date('2026-01-01'),
      lastSeenAt: new Date('2026-05-01'),
    });
    consume = buildOutboxConsumer(db);
  });

  it('projects actions.unsubscribe_intent_recorded into sender_policies', async () => {
    await consume({
      id: 'evt-1',
      topic: TOPICS.ACTIONS_UNSUBSCRIBE_INTENT_RECORDED,
      aggregateId: '00000000-0000-4000-8000-000000000001',
      payload: {
        mailboxAccountId: mailboxId,
        senderKey: SENDER_KEY_A,
        activityLogId: '00000000-0000-4000-8000-000000000001',
        recordedAt: new Date().toISOString(),
      },
      attempts: 1,
      createdAt: new Date(),
    });
    const rows = await db
      .select()
      .from(senderPolicies)
      .where(eq(senderPolicies.mailboxAccountId, mailboxId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.policyType).toBe('unsubscribe');
    expect(rows[0]!.senderKey).toBe(SENDER_KEY_A);
  });

  it('is idempotent on redelivery — same event twice → ONE row', async () => {
    const event = {
      id: 'evt-2',
      topic: TOPICS.ACTIONS_UNSUBSCRIBE_INTENT_RECORDED,
      aggregateId: '00000000-0000-4000-8000-000000000002',
      payload: {
        mailboxAccountId: mailboxId,
        senderKey: SENDER_KEY_A,
        activityLogId: '00000000-0000-4000-8000-000000000002',
        recordedAt: new Date().toISOString(),
      },
      attempts: 1,
      createdAt: new Date(),
    } as const;
    await consume(event);
    await consume(event);
    const rows = await db
      .select()
      .from(senderPolicies)
      .where(eq(senderPolicies.mailboxAccountId, mailboxId));
    expect(rows).toHaveLength(1);
  });

  it('preserves existing is_protected / is_vip / protection_reason', async () => {
    await db.insert(senderPolicies).values({
      mailboxAccountId: mailboxId,
      senderKey: SENDER_KEY_A,
      isProtected: true,
      isVip: true,
      protectionReason: 'user_defined',
    });
    await consume({
      id: 'evt-3',
      topic: TOPICS.ACTIONS_UNSUBSCRIBE_INTENT_RECORDED,
      aggregateId: '00000000-0000-4000-8000-000000000003',
      payload: {
        mailboxAccountId: mailboxId,
        senderKey: SENDER_KEY_A,
        activityLogId: '00000000-0000-4000-8000-000000000003',
        recordedAt: new Date().toISOString(),
      },
      attempts: 1,
      createdAt: new Date(),
    });
    const rows = await db
      .select()
      .from(senderPolicies)
      .where(eq(senderPolicies.mailboxAccountId, mailboxId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.policyType).toBe('unsubscribe');
    expect(rows[0]!.isProtected).toBe(true);
    expect(rows[0]!.isVip).toBe(true);
    expect(rows[0]!.protectionReason).toBe('user_defined');
  });

  it('logs + no-ops on an unknown topic (does not throw)', async () => {
    await expect(
      consume({
        id: 'evt-unknown',
        topic: 'unknown.future_topic' as never,
        aggregateId: '00000000-0000-4000-8000-000000000004',
        payload: { foo: 'bar' },
        attempts: 1,
        createdAt: new Date(),
      }),
    ).resolves.toBeUndefined();
    const rows = await db.select().from(senderPolicies);
    expect(rows).toHaveLength(0);
  });
});
