import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import {
  activityLog,
  followupTracker,
  mailboxAccounts,
  schema,
  users,
  workspaces,
} from '@declutrmail/db';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { FollowupReadService } from './followup.read-service.js';

/**
 * FollowupReadService integration tests (D84-D91).
 *
 * Runs the real service against in-process PGlite with every migration
 * applied. Covers tenant isolation, D85 priority bucket derivation,
 * the awaiting-only filter, and the idempotent dismiss flow.
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
const NOW_MS = new Date('2026-05-25T08:00:00Z').getTime();

async function freshDb(): Promise<Db> {
  const pg = new PGlite({ extensions: { citext } });
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    const sqlText = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of sqlText.split('--> statement-breakpoint')) {
      const trimmed = stmt.trim();
      if (trimmed) {
        await pg.query(trimmed);
      }
    }
  }
  return drizzle(pg, { schema });
}

async function seedMailbox(
  db: Db,
  email: string,
): Promise<{ workspaceId: string; mailboxAccountId: string }> {
  const [ws] = await db
    .insert(workspaces)
    .values({ name: `WS-${email}` })
    .returning({
      id: workspaces.id,
    });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: ws!.id, email })
    .returning({ id: users.id });
  const [mb] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId: ws!.id,
      userId: user!.id,
      provider: 'gmail',
      providerAccountId: email,
    })
    .returning({ id: mailboxAccounts.id });
  return { workspaceId: ws!.id, mailboxAccountId: mb!.id };
}

async function seedFollowup(
  db: Db,
  workspaceId: string,
  mailboxAccountId: string,
  partial: {
    threadId: string;
    sentAt: Date;
    status?: 'awaiting' | 'replied' | 'dismissed';
    subject?: string;
    recipientEmail?: string;
  },
): Promise<string> {
  const [row] = await db
    .insert(followupTracker)
    .values({
      workspaceId,
      mailboxAccountId,
      providerThreadId: partial.threadId,
      recipientEmail: partial.recipientEmail ?? 'boss@example.com',
      subject: partial.subject ?? 'subj',
      sentAt: partial.sentAt,
      status: partial.status ?? 'awaiting',
      ...(partial.status === 'dismissed' ? { dismissedAt: new Date() } : {}),
    })
    .returning({ id: followupTracker.id });
  return row!.id;
}

describe('FollowupReadService', () => {
  let db: Db;
  let service: FollowupReadService;
  let mailboxA: { workspaceId: string; mailboxAccountId: string };
  let mailboxB: { workspaceId: string; mailboxAccountId: string };

  beforeEach(async () => {
    db = await freshDb();
    service = new FollowupReadService(db as never);
    mailboxA = await seedMailbox(db, 'a@example.com');
    mailboxB = await seedMailbox(db, 'b@example.com');
  });

  describe('listAwaiting', () => {
    it('returns only awaiting rows (excludes replied + dismissed)', async () => {
      await seedFollowup(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, {
        threadId: 't1',
        sentAt: new Date(NOW_MS - 2 * 24 * 60 * 60 * 1000),
        subject: 'active',
      });
      await seedFollowup(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, {
        threadId: 't2',
        sentAt: new Date(NOW_MS - 2 * 24 * 60 * 60 * 1000),
        status: 'replied',
        subject: 'replied',
      });
      await seedFollowup(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, {
        threadId: 't3',
        sentAt: new Date(NOW_MS - 2 * 24 * 60 * 60 * 1000),
        status: 'dismissed',
        subject: 'dismissed',
      });

      const list = await service.listAwaiting(mailboxA.mailboxAccountId, NOW_MS);
      expect(list).toHaveLength(1);
      expect(list[0]!.subject).toBe('active');
      expect(list[0]!.status).toBe('awaiting');
    });

    it('orders newest first by sent_at', async () => {
      await seedFollowup(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, {
        threadId: 'older',
        sentAt: new Date(NOW_MS - 10 * 24 * 60 * 60 * 1000),
        subject: 'older',
      });
      await seedFollowup(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, {
        threadId: 'newer',
        sentAt: new Date(NOW_MS - 2 * 24 * 60 * 60 * 1000),
        subject: 'newer',
      });
      const list = await service.listAwaiting(mailboxA.mailboxAccountId, NOW_MS);
      expect(list.map((f) => f.subject)).toEqual(['newer', 'older']);
    });

    it('does not leak rows across tenants', async () => {
      await seedFollowup(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, {
        threadId: 'a1',
        sentAt: new Date(NOW_MS - 2 * 24 * 60 * 60 * 1000),
      });
      await seedFollowup(db, mailboxB.workspaceId, mailboxB.mailboxAccountId, {
        threadId: 'b1',
        sentAt: new Date(NOW_MS - 2 * 24 * 60 * 60 * 1000),
      });
      const a = await service.listAwaiting(mailboxA.mailboxAccountId, NOW_MS);
      const b = await service.listAwaiting(mailboxB.mailboxAccountId, NOW_MS);
      expect(a).toHaveLength(1);
      expect(b).toHaveLength(1);
      expect(a[0]!.id).not.toBe(b[0]!.id);
    });

    describe('D85 priority bucket', () => {
      it('high when sent > 7 days ago', async () => {
        await seedFollowup(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, {
          threadId: 't',
          sentAt: new Date(NOW_MS - 10 * 24 * 60 * 60 * 1000),
        });
        const [row] = await service.listAwaiting(mailboxA.mailboxAccountId, NOW_MS);
        expect(row!.priority).toBe('high');
      });

      it('medium when sent 3–7 days ago (boundary at exactly 3 days)', async () => {
        await seedFollowup(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, {
          threadId: 't',
          sentAt: new Date(NOW_MS - 3 * 24 * 60 * 60 * 1000),
        });
        const [row] = await service.listAwaiting(mailboxA.mailboxAccountId, NOW_MS);
        expect(row!.priority).toBe('medium');
      });

      it('low when sent 1–3 days ago', async () => {
        await seedFollowup(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, {
          threadId: 't',
          sentAt: new Date(NOW_MS - 2 * 24 * 60 * 60 * 1000),
        });
        const [row] = await service.listAwaiting(mailboxA.mailboxAccountId, NOW_MS);
        expect(row!.priority).toBe('low');
      });

      it('fresh when sent <1 day ago', async () => {
        await seedFollowup(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, {
          threadId: 't',
          sentAt: new Date(NOW_MS - 6 * 60 * 60 * 1000),
        });
        const [row] = await service.listAwaiting(mailboxA.mailboxAccountId, NOW_MS);
        expect(row!.priority).toBe('fresh');
      });

      it('exactly 7 days → medium (strict > 7 for high)', async () => {
        await seedFollowup(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, {
          threadId: 't',
          sentAt: new Date(NOW_MS - 7 * 24 * 60 * 60 * 1000),
        });
        const [row] = await service.listAwaiting(mailboxA.mailboxAccountId, NOW_MS);
        expect(row!.priority).toBe('medium');
      });
    });
  });

  describe('dismiss', () => {
    it('flips awaiting → dismissed and sets dismissedAt', async () => {
      const id = await seedFollowup(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, {
        threadId: 't',
        sentAt: new Date(NOW_MS - 2 * 24 * 60 * 60 * 1000),
      });
      const result = await service.dismiss(mailboxA.mailboxAccountId, id);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(id);
      expect(result!.status).toBe('dismissed');
      expect(typeof result!.dismissedAt).toBe('string');

      const [row] = await db
        .select({
          status: followupTracker.status,
          dismissedAt: followupTracker.dismissedAt,
        })
        .from(followupTracker)
        .where(eq(followupTracker.id, id));
      expect(row!.status).toBe('dismissed');
      expect(row!.dismissedAt).not.toBeNull();
    });

    it('D88 — writes an activity_log row with source=manual + action=followup-dismiss', async () => {
      const id = await seedFollowup(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, {
        threadId: 't',
        sentAt: new Date(NOW_MS - 2 * 24 * 60 * 60 * 1000),
      });
      await service.dismiss(mailboxA.mailboxAccountId, id);

      const rows = await db
        .select({
          source: activityLog.source,
          action: activityLog.action,
          senderKey: activityLog.senderKey,
          affectedCount: activityLog.affectedCount,
        })
        .from(activityLog)
        .where(eq(activityLog.mailboxAccountId, mailboxA.mailboxAccountId));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.source).toBe('manual');
      expect(rows[0]!.action).toBe('followup-dismiss');
      // Thread-scoped, not sender-scoped — D88 audit row carries no sender_key.
      expect(rows[0]!.senderKey).toBeNull();
      expect(rows[0]!.affectedCount).toBe(1);
    });

    it('D88 — failed dismiss (already terminal) does NOT write an activity_log row', async () => {
      const id = await seedFollowup(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, {
        threadId: 't',
        sentAt: new Date(NOW_MS - 2 * 24 * 60 * 60 * 1000),
        status: 'replied',
      });
      const result = await service.dismiss(mailboxA.mailboxAccountId, id);
      expect(result).toBeNull();

      const rows = await db
        .select({ id: activityLog.id })
        .from(activityLog)
        .where(eq(activityLog.mailboxAccountId, mailboxA.mailboxAccountId));
      expect(rows).toHaveLength(0);
    });

    it('returns null on cross-tenant dismiss attempts', async () => {
      const id = await seedFollowup(db, mailboxB.workspaceId, mailboxB.mailboxAccountId, {
        threadId: 't',
        sentAt: new Date(NOW_MS - 2 * 24 * 60 * 60 * 1000),
      });
      const result = await service.dismiss(mailboxA.mailboxAccountId, id);
      expect(result).toBeNull();
    });

    it('returns null when dismissing a replied row', async () => {
      const id = await seedFollowup(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, {
        threadId: 't',
        sentAt: new Date(NOW_MS - 2 * 24 * 60 * 60 * 1000),
        status: 'replied',
      });
      const result = await service.dismiss(mailboxA.mailboxAccountId, id);
      expect(result).toBeNull();
    });

    it('second dismiss of the same row returns null (already terminal)', async () => {
      const id = await seedFollowup(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, {
        threadId: 't',
        sentAt: new Date(NOW_MS - 2 * 24 * 60 * 60 * 1000),
      });
      const first = await service.dismiss(mailboxA.mailboxAccountId, id);
      expect(first).not.toBeNull();
      const second = await service.dismiss(mailboxA.mailboxAccountId, id);
      expect(second).toBeNull();
    });

    it('returns null for an unknown id', async () => {
      const result = await service.dismiss(
        mailboxA.mailboxAccountId,
        '00000000-0000-0000-0000-000000000000',
      );
      expect(result).toBeNull();
    });
  });
});
