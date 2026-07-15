import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import {
  mailMessages,
  mailboxAccounts,
  schema,
  senderPolicies,
  senders,
  users,
  workspaces,
} from '@declutrmail/db';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Queue } from 'bullmq';

import type { SnoozeLabelMapStore, SnoozeWakeJobData } from '@declutrmail/workers';

import { CAPABILITY_EXEMPT_METADATA } from '../common/entitlements/capability.guard.js';
import { SnoozeService } from './snooze.service.js';
import { SnoozedController } from './snoozed.controller.js';
import { SnoozedReadService } from './snoozed.read-service.js';

/**
 * Snoozed surface integration tests (D78–D80) — the read service's
 * mirror ∪ timer merge and the write service's set/extend/clear +
 * wake-now enqueue, against in-process PGlite with every migration.
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

type Db = ReturnType<typeof drizzle<typeof schema>>;

async function freshDb(): Promise<Db> {
  const pg = new PGlite({ extensions: { citext } });
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of sql.split('--> statement-breakpoint')) {
      const trimmed = stmt.trim();
      if (trimmed) {
        await pg.query(trimmed);
      }
    }
  }
  return drizzle(pg, { schema });
}

const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);
const LATER_ID = 'Label_7';

async function seedMailbox(db: Db, email = 'owner@declutrmail.ai'): Promise<string> {
  const [ws] = await db.insert(workspaces).values({ name: 'WS' }).returning({ id: workspaces.id });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: ws!.id, email })
    .returning({ id: users.id });
  const [mailbox] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId: ws!.id,
      userId: user!.id,
      provider: 'gmail',
      providerAccountId: email,
    })
    .returning({ id: mailboxAccounts.id });
  return mailbox!.id;
}

async function seedSender(
  db: Db,
  mailboxAccountId: string,
  senderKey: string,
  email: string,
): Promise<string> {
  const [s] = await db
    .insert(senders)
    .values({
      mailboxAccountId,
      senderKey,
      displayName: email.split('@')[0]!,
      email,
      domain: email.split('@')[1]!,
      gmailCategory: 'promotions',
      firstSeenAt: new Date('2026-01-01'),
      lastSeenAt: new Date('2026-05-01'),
    })
    .returning({ id: senders.id });
  return s!.id;
}

async function seedMessage(
  db: Db,
  mailboxAccountId: string,
  senderKey: string,
  providerMessageId: string,
  labelIds: string[],
): Promise<void> {
  await db.insert(mailMessages).values({
    mailboxAccountId,
    providerMessageId,
    providerThreadId: `t-${providerMessageId}`,
    senderKey,
    internalDate: new Date('2026-05-01'),
    isUnread: false,
    labelIds,
  });
}

function labelMapWith(entries: Record<string, string>): SnoozeLabelMapStore {
  return {
    get: async (id) => entries[id] ?? null,
    set: async () => {},
  };
}

describe('SnoozedReadService.list', () => {
  let db: Db;
  let mailboxId: string;
  let senderAId: string;

  beforeEach(async () => {
    db = await freshDb();
    mailboxId = await seedMailbox(db);
    senderAId = await seedSender(db, mailboxId, KEY_A, 'digest@news.example');
  });

  it('lists only timer-backed Later rows and uses the mirror for counts', async () => {
    const senderBId = await seedSender(db, mailboxId, KEY_B, 'offers@shop.example');
    // A: mirror-only, so it is not a valid Later row. B: timer-backed.
    await seedMessage(db, mailboxId, KEY_A, 'm1', [LATER_ID]);
    await seedMessage(db, mailboxId, KEY_A, 'm2', [LATER_ID, 'STARRED']);
    await seedMessage(db, mailboxId, KEY_A, 'm3', ['INBOX']); // not Later
    await db.insert(senderPolicies).values({
      mailboxAccountId: mailboxId,
      senderKey: KEY_B,
      snoozedUntil: new Date('2026-06-12T09:00:00Z'),
      snoozedAt: new Date('2026-06-11T09:00:00Z'),
      snoozedReason: 'after launch',
    });

    const service = new SnoozedReadService(db as never, labelMapWith({ [mailboxId]: LATER_ID }));
    const rows = await service.list(mailboxId, new Date('2026-06-11T10:00:00Z'));

    expect(rows).toHaveLength(1);
    expect(rows[0]!.senderId).toBe(senderBId);
    expect(rows[0]!.laterCount).toBe(0);
    expect(rows[0]!.snoozedUntil).toBe('2026-06-12T09:00:00.000Z');
    expect(rows[0]!.reason).toBe('after launch');
    expect(rows[0]!.returnStatus).toBe('scheduled');
    expect(rows.some((row) => row.senderId === senderAId)).toBe(false);
  });

  it('degrades honestly when the label mapping is missing', async () => {
    await seedMessage(db, mailboxId, KEY_A, 'm1', [LATER_ID]);
    await db.insert(senderPolicies).values({
      mailboxAccountId: mailboxId,
      senderKey: KEY_A,
      snoozedUntil: new Date('2026-06-12T09:00:00Z'),
    });

    const service = new SnoozedReadService(db as never, labelMapWith({}));
    const rows = await service.list(mailboxId);

    // Timer row still returns; the count is unknown, never guessed.
    expect(rows).toHaveLength(1);
    expect(rows[0]!.laterCount).toBeNull();
  });

  it('a hung/throwing mapping store degrades instead of failing', async () => {
    await db.insert(senderPolicies).values({
      mailboxAccountId: mailboxId,
      senderKey: KEY_A,
      snoozedUntil: new Date('2026-06-12T09:00:00Z'),
    });
    const service = new SnoozedReadService(db as never, {
      get: async () => {
        throw new Error('redis down');
      },
      set: async () => {},
    });
    const rows = await service.list(mailboxId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.laterCount).toBeNull();
  });

  it('scopes to the mailbox — another mailbox sees nothing', async () => {
    const otherMailbox = await seedMailbox(db, 'other@declutrmail.ai');
    await seedMessage(db, mailboxId, KEY_A, 'm1', [LATER_ID]);

    const service = new SnoozedReadService(
      db as never,
      labelMapWith({ [mailboxId]: LATER_ID, [otherMailbox]: LATER_ID }),
    );
    expect(await service.list(otherMailbox)).toEqual([]);
  });

  it('returns [] when nothing is later-labelled or snoozed', async () => {
    const service = new SnoozedReadService(db as never, labelMapWith({ [mailboxId]: LATER_ID }));
    expect(await service.list(mailboxId)).toEqual([]);
  });

  it('distinguishes returning, missed, and recorded retry failures', async () => {
    await db.insert(senderPolicies).values({
      mailboxAccountId: mailboxId,
      senderKey: KEY_A,
      snoozedUntil: new Date('2026-06-11T09:00:00Z'),
    });
    const service = new SnoozedReadService(db as never, labelMapWith({}));

    const returning = await service.list(mailboxId, new Date('2026-06-11T09:15:00Z'));
    expect(returning[0]!.returnStatus).toBe('returning');

    const missed = await service.list(mailboxId, new Date('2026-06-11T09:30:00Z'));
    expect(missed[0]!.returnStatus).toBe('missed');

    await db
      .update(senderPolicies)
      .set({
        snoozeWakeLastAttemptAt: new Date('2026-06-11T09:01:00Z'),
        snoozeWakeLastFailedAt: new Date('2026-06-11T09:01:00Z'),
        snoozeWakeFailureCount: 1,
        snoozeWakeFailureKind: 'reauthorize',
      })
      .where(eq(senderPolicies.mailboxAccountId, mailboxId));
    const failed = await service.list(mailboxId, new Date('2026-06-11T09:02:00Z'));
    expect(failed[0]).toMatchObject({
      returnStatus: 'retrying',
      lastReturnAttemptAt: '2026-06-11T09:01:00.000Z',
      returnFailureKind: 'reauthorize',
    });
  });

  it('returns a small all-tier recovery summary without the label mirror', async () => {
    await db.insert(senderPolicies).values({
      mailboxAccountId: mailboxId,
      senderKey: KEY_A,
      snoozedUntil: new Date('2026-06-11T09:00:00Z'),
    });
    const service = new SnoozedReadService(db as never, null);
    const summary = await service.recovery(mailboxId, new Date('2026-06-11T09:30:00Z'));

    expect(summary.affectedCount).toBe(1);
    expect(summary.firstIssue).toMatchObject({
      senderId: senderAId,
      returnStatus: 'missed',
      returnFailureKind: null,
    });
  });

  it('rejects incoherent durable failure state at the database boundary', async () => {
    await expect(
      db.insert(senderPolicies).values({
        mailboxAccountId: mailboxId,
        senderKey: KEY_A,
        snoozedUntil: new Date('2026-06-11T09:00:00Z'),
        snoozeWakeFailureCount: 1,
      }),
    ).rejects.toThrow();

    await expect(
      db.insert(senderPolicies).values({
        mailboxAccountId: mailboxId,
        senderKey: KEY_A,
        snoozeWakeLastAttemptAt: new Date('2026-06-11T09:01:00Z'),
        snoozeWakeLastFailedAt: new Date('2026-06-11T09:01:00Z'),
        snoozeWakeFailureCount: 1,
        snoozeWakeFailureKind: 'temporary',
      }),
    ).rejects.toThrow();
  });
});

describe('SnoozeService.setSnooze', () => {
  let db: Db;
  let mailboxId: string;
  let senderAId: string;
  let service: SnoozeService;

  beforeEach(async () => {
    db = await freshDb();
    mailboxId = await seedMailbox(db);
    senderAId = await seedSender(db, mailboxId, KEY_A, 'digest@news.example');
    service = new SnoozeService(db as never, null);
  });

  async function policyRow() {
    const [row] = await db
      .select()
      .from(senderPolicies)
      .where(
        and(eq(senderPolicies.mailboxAccountId, mailboxId), eq(senderPolicies.senderKey, KEY_A)),
      );
    return row ?? null;
  }

  it('sets a timer on a sender with no policy row (verdict untouched)', async () => {
    const result = await service.setSnooze({
      mailboxAccountId: mailboxId,
      senderId: senderAId,
      until: '2026-06-12T09:00:00.000Z',
      reason: 'after launch',
    });

    expect(result.changed).toBe(true);
    expect(result.snoozedUntil).toBe('2026-06-12T09:00:00.000Z');
    expect(result.reason).toBe('after launch');

    const row = await policyRow();
    expect(row!.snoozedUntil!.toISOString()).toBe('2026-06-12T09:00:00.000Z');
    expect(row!.policyType).toBe('keep'); // column default — not a verdict write
    expect(row!.isProtected).toBe(false);
  });

  it('extends an existing timer and replaces the note', async () => {
    await service.setSnooze({
      mailboxAccountId: mailboxId,
      senderId: senderAId,
      until: '2026-06-12T09:00:00.000Z',
      reason: 'first note',
    });
    const result = await service.setSnooze({
      mailboxAccountId: mailboxId,
      senderId: senderAId,
      until: '2026-07-01T09:00:00.000Z',
    });
    expect(result.changed).toBe(true);
    expect(result.snoozedUntil).toBe('2026-07-01T09:00:00.000Z');
    // Full-state write — omitted reason clears the note.
    expect(result.reason).toBeNull();
  });

  it('does not clobber an existing standing verdict', async () => {
    await db.insert(senderPolicies).values({
      mailboxAccountId: mailboxId,
      senderKey: KEY_A,
      policyType: 'unsubscribe',
    });
    await service.setSnooze({
      mailboxAccountId: mailboxId,
      senderId: senderAId,
      until: '2026-06-12T09:00:00.000Z',
    });
    const row = await policyRow();
    expect(row!.policyType).toBe('unsubscribe');
    expect(row!.snoozedUntil).not.toBeNull();
  });

  it('idempotent replay — same until + reason is changed:false', async () => {
    const input = {
      mailboxAccountId: mailboxId,
      senderId: senderAId,
      until: '2026-06-12T09:00:00.000Z',
      reason: 'note',
    };
    await service.setSnooze(input);
    const replay = await service.setSnooze(input);
    expect(replay.changed).toBe(false);
  });

  it('treats the same schedule as an explicit retry when return state failed', async () => {
    const input = {
      mailboxAccountId: mailboxId,
      senderId: senderAId,
      until: '2026-06-12T09:00:00.000Z',
      reason: 'note',
    };
    await service.setSnooze(input);
    await db
      .update(senderPolicies)
      .set({
        snoozeWakeLastAttemptAt: new Date('2026-06-12T09:01:00Z'),
        snoozeWakeLastFailedAt: new Date('2026-06-12T09:01:00Z'),
        snoozeWakeFailureCount: 2,
        snoozeWakeFailureKind: 'temporary',
      })
      .where(eq(senderPolicies.mailboxAccountId, mailboxId));

    const replay = await service.setSnooze(input);
    expect(replay.changed).toBe(true);
    const row = await policyRow();
    expect(row!.snoozeWakeLastAttemptAt).toBeNull();
    expect(row!.snoozeWakeLastFailedAt).toBeNull();
    expect(row!.snoozeWakeFailureCount).toBe(0);
    expect(row!.snoozeWakeFailureKind).toBeNull();
  });

  it('404s a forged / cross-mailbox sender id', async () => {
    await expect(
      service.setSnooze({
        mailboxAccountId: mailboxId,
        senderId: randomUUID(),
        until: '2026-06-12T09:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('SnoozeService.wakeNow', () => {
  let db: Db;
  let mailboxId: string;
  let senderAId: string;

  beforeEach(async () => {
    db = await freshDb();
    mailboxId = await seedMailbox(db);
    senderAId = await seedSender(db, mailboxId, KEY_A, 'digest@news.example');
  });

  it('503s when the queue is unavailable (REDIS_URL unset)', async () => {
    await db.insert(senderPolicies).values({
      mailboxAccountId: mailboxId,
      senderKey: KEY_A,
      snoozedUntil: new Date('2026-08-01T09:00:00Z'),
      snoozedAt: new Date('2026-07-14T09:00:00Z'),
    });
    const service = new SnoozeService(db as never, null);
    await expect(
      service.wakeNow({ mailboxAccountId: mailboxId, senderId: senderAId }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('enqueues a targeted wake pinned to the current timer and failure generation', async () => {
    await db.insert(senderPolicies).values({
      mailboxAccountId: mailboxId,
      senderKey: KEY_A,
      snoozedUntil: new Date('2026-08-01T09:00:00Z'),
      snoozedAt: new Date('2026-07-14T09:00:00Z'),
      snoozeWakeLastAttemptAt: new Date('2026-07-14T09:30:00Z'),
      snoozeWakeLastFailedAt: new Date('2026-07-14T09:30:00Z'),
      snoozeWakeFailureCount: 2,
      snoozeWakeFailureKind: 'temporary',
    });
    const add = vi.fn();
    const service = new SnoozeService(db as never, { add } as unknown as Queue<SnoozeWakeJobData>);

    const result = await service.wakeNow({ mailboxAccountId: mailboxId, senderId: senderAId });

    expect(result).toEqual({ senderId: senderAId, status: 'queued' });
    expect(add).toHaveBeenCalledTimes(1);
    const [jobName, data, opts] = add.mock.calls[0]!;
    expect(jobName).toBe('snooze-wake');
    expect(data).toMatchObject({
      kind: 'wake',
      mailboxAccountId: mailboxId,
      senderKey: KEY_A,
      expectedSnoozedUntil: '2026-08-01T09:00:00.000Z',
      expectedSnoozedAt: '2026-07-14T09:00:00.000Z',
      attemptDiscriminator: 'manual-2',
    });
    expect(String(opts.jobId)).not.toContain(':');
  });

  it('rejects Wake now when the sender no longer has an active timer', async () => {
    const add = vi.fn();
    const service = new SnoozeService(db as never, { add } as unknown as Queue<SnoozeWakeJobData>);

    await expect(
      service.wakeNow({ mailboxAccountId: mailboxId, senderId: senderAId }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(add).not.toHaveBeenCalled();
  });

  it('404s a forged sender id before touching the queue', async () => {
    const add = vi.fn();
    const service = new SnoozeService(db as never, { add } as unknown as Queue<SnoozeWakeJobData>);
    await expect(
      service.wakeNow({ mailboxAccountId: mailboxId, senderId: randomUUID() }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(add).not.toHaveBeenCalled();
  });

  it('rejects all-tier recovery for a healthy timer', async () => {
    await db.insert(senderPolicies).values({
      mailboxAccountId: mailboxId,
      senderKey: KEY_A,
      snoozedUntil: new Date('2026-08-01T09:00:00Z'),
      snoozedAt: new Date('2026-07-14T09:00:00Z'),
    });
    const add = vi.fn();
    const service = new SnoozeService(db as never, { add } as unknown as Queue<SnoozeWakeJobData>);

    await expect(
      service.wakeRecovery(
        { mailboxAccountId: mailboxId, senderId: senderAId },
        new Date('2026-07-14T10:00:00Z'),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(add).not.toHaveBeenCalled();
  });

  it('allows all-tier recovery only after a timer is missed', async () => {
    await db.insert(senderPolicies).values({
      mailboxAccountId: mailboxId,
      senderKey: KEY_A,
      snoozedUntil: new Date('2026-07-14T09:00:00Z'),
      snoozedAt: new Date('2026-07-13T09:00:00Z'),
    });
    const add = vi.fn();
    const service = new SnoozeService(db as never, { add } as unknown as Queue<SnoozeWakeJobData>);

    await expect(
      service.wakeRecovery(
        { mailboxAccountId: mailboxId, senderId: senderAId },
        new Date('2026-07-14T09:30:00Z'),
      ),
    ).resolves.toEqual({ senderId: senderAId, status: 'queued' });
    expect(add).toHaveBeenCalledTimes(1);
    expect(add.mock.calls[0]![1]).toMatchObject({
      expectedSnoozedUntil: '2026-07-14T09:00:00.000Z',
      expectedSnoozedAt: '2026-07-13T09:00:00.000Z',
      attemptDiscriminator: 'recovery-0',
    });
  });
});

describe('SnoozedController recovery entitlement', () => {
  it('never paywalls failure visibility or immediate recovery', () => {
    expect(
      Reflect.getMetadata(CAPABILITY_EXEMPT_METADATA, SnoozedController.prototype.recovery),
    ).toBe(true);
    expect(
      Reflect.getMetadata(CAPABILITY_EXEMPT_METADATA, SnoozedController.prototype.wakeRecovery),
    ).toBe(true);
    expect(
      Reflect.getMetadata(CAPABILITY_EXEMPT_METADATA, SnoozedController.prototype.wakeNow),
    ).toBeUndefined();
  });
});
