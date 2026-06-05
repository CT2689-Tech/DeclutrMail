import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import {
  activityLog,
  mailboxAccounts,
  schema,
  senders,
  undoJournal,
  users,
  workspaces,
} from '@declutrmail/db';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

import { ActivityReadService } from './activity.read-service.js';

/**
 * ActivityReadService integration tests (D55-D60, tracer-bullet).
 *
 * Runs the real service against in-process PGlite with every migration
 * applied. Covers tenant isolation, window filtering, source filtering,
 * cursor pagination, stats aggregation, and the D58 undo-state
 * resolution (available / expired / executed / unavailable).
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
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

async function freshDb(): Promise<Db> {
  const pg = new PGlite({ extensions: { citext } });
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    const sqlText = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of sqlText.split('--> statement-breakpoint')) {
      const trimmed = stmt.trim();
      if (trimmed) await pg.query(trimmed);
    }
  }
  return drizzle(pg, { schema });
}

async function seedMailbox(db: Db, email: string) {
  const [ws] = await db
    .insert(workspaces)
    .values({ name: `WS-${email}` })
    .returning({ id: workspaces.id });
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

async function seedSender(
  db: Db,
  mailboxAccountId: string,
  senderKey: string,
  email: string,
  displayName: string,
) {
  const at = email.lastIndexOf('@');
  const domain = at === -1 ? email : email.slice(at + 1);
  await db.insert(senders).values({
    mailboxAccountId,
    senderKey,
    email,
    displayName,
    domain,
    gmailCategory: 'primary',
    firstSeenAt: new Date(NOW_MS - 30 * ONE_DAY_MS),
    lastSeenAt: new Date(NOW_MS - 1 * ONE_DAY_MS),
  });
}

async function seedUndoToken(
  db: Db,
  mailboxAccountId: string,
  args: { expiresAt: Date; executedAt?: Date; revertedAt?: Date },
): Promise<string> {
  const [row] = await db
    .insert(undoJournal)
    .values({
      mailboxAccountId,
      actionKind: 'archive',
      expiresAt: args.expiresAt,
      ...(args.executedAt ? { executedAt: args.executedAt } : {}),
      ...(args.revertedAt ? { revertedAt: args.revertedAt } : {}),
    })
    .returning({ token: undoJournal.token });
  return row!.token;
}

async function seedActivity(
  db: Db,
  args: {
    mailboxAccountId: string;
    occurredAt: Date;
    source: 'triage' | 'manual' | 'autopilot' | 'screener';
    action: 'keep' | 'archive' | 'unsubscribe' | 'later' | 'followup-dismiss';
    affectedCount?: number;
    senderKey?: string;
    undoToken?: string;
  },
): Promise<string> {
  const [row] = await db
    .insert(activityLog)
    .values({
      mailboxAccountId: args.mailboxAccountId,
      occurredAt: args.occurredAt,
      source: args.source,
      action: args.action,
      affectedCount: args.affectedCount ?? 1,
      ...(args.senderKey ? { senderKey: args.senderKey } : {}),
      ...(args.undoToken ? { undoToken: args.undoToken } : {}),
    })
    .returning({ id: activityLog.id });
  return row!.id;
}

describe('ActivityReadService', () => {
  let db: Db;
  let svc: ActivityReadService;
  let mailboxA: { workspaceId: string; mailboxAccountId: string };
  let mailboxB: { workspaceId: string; mailboxAccountId: string };

  beforeEach(async () => {
    db = await freshDb();
    svc = new ActivityReadService(db as never);
    mailboxA = await seedMailbox(db, 'a@example.com');
    mailboxB = await seedMailbox(db, 'b@example.com');
  });

  it('returns only rows for the requested mailbox (tenant isolation)', async () => {
    await seedActivity(db, {
      mailboxAccountId: mailboxA.mailboxAccountId,
      occurredAt: new Date(NOW_MS - 1 * ONE_DAY_MS),
      source: 'manual',
      action: 'archive',
    });
    await seedActivity(db, {
      mailboxAccountId: mailboxB.mailboxAccountId,
      occurredAt: new Date(NOW_MS - 1 * ONE_DAY_MS),
      source: 'manual',
      action: 'archive',
    });

    const { rows } = await svc.listActivity({
      mailboxAccountId: mailboxA.mailboxAccountId,
      window: '30d',
      source: null,
      cursor: null,
      limit: 25,
      nowMs: NOW_MS,
    });
    expect(rows).toHaveLength(1);
  });

  it('D55 — window filter excludes rows older than 30 days for window=30d', async () => {
    await seedActivity(db, {
      mailboxAccountId: mailboxA.mailboxAccountId,
      occurredAt: new Date(NOW_MS - 5 * ONE_DAY_MS),
      source: 'manual',
      action: 'archive',
    });
    await seedActivity(db, {
      mailboxAccountId: mailboxA.mailboxAccountId,
      occurredAt: new Date(NOW_MS - 60 * ONE_DAY_MS),
      source: 'manual',
      action: 'archive',
    });

    const { rows: rows30 } = await svc.listActivity({
      mailboxAccountId: mailboxA.mailboxAccountId,
      window: '30d',
      source: null,
      cursor: null,
      limit: 25,
      nowMs: NOW_MS,
    });
    expect(rows30).toHaveLength(1);

    const { rows: rows90 } = await svc.listActivity({
      mailboxAccountId: mailboxA.mailboxAccountId,
      window: '90d',
      source: null,
      cursor: null,
      limit: 25,
      nowMs: NOW_MS,
    });
    expect(rows90).toHaveLength(2);
  });

  it('D55 — window=all returns rows older than every windowed bound', async () => {
    await seedActivity(db, {
      mailboxAccountId: mailboxA.mailboxAccountId,
      occurredAt: new Date(NOW_MS - 365 * ONE_DAY_MS),
      source: 'manual',
      action: 'archive',
    });
    const { rows } = await svc.listActivity({
      mailboxAccountId: mailboxA.mailboxAccountId,
      window: 'all',
      source: null,
      cursor: null,
      limit: 25,
      nowMs: NOW_MS,
    });
    expect(rows).toHaveLength(1);
  });

  it('D56 — source filter narrows to one enum value', async () => {
    await seedActivity(db, {
      mailboxAccountId: mailboxA.mailboxAccountId,
      occurredAt: new Date(NOW_MS - 1 * ONE_DAY_MS),
      source: 'manual',
      action: 'archive',
    });
    await seedActivity(db, {
      mailboxAccountId: mailboxA.mailboxAccountId,
      occurredAt: new Date(NOW_MS - 1 * ONE_DAY_MS),
      source: 'autopilot',
      action: 'archive',
    });

    const { rows } = await svc.listActivity({
      mailboxAccountId: mailboxA.mailboxAccountId,
      window: '30d',
      source: 'autopilot',
      cursor: null,
      limit: 25,
      nowMs: NOW_MS,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.source).toBe('autopilot');
  });

  it('orders rows by occurred_at DESC, id DESC', async () => {
    const t1 = await seedActivity(db, {
      mailboxAccountId: mailboxA.mailboxAccountId,
      occurredAt: new Date(NOW_MS - 3 * ONE_DAY_MS),
      source: 'manual',
      action: 'archive',
    });
    const t2 = await seedActivity(db, {
      mailboxAccountId: mailboxA.mailboxAccountId,
      occurredAt: new Date(NOW_MS - 1 * ONE_DAY_MS),
      source: 'manual',
      action: 'archive',
    });

    const { rows } = await svc.listActivity({
      mailboxAccountId: mailboxA.mailboxAccountId,
      window: '30d',
      source: null,
      cursor: null,
      limit: 25,
      nowMs: NOW_MS,
    });
    expect(rows.map((r) => r.id)).toEqual([t2, t1]);
  });

  it('joins sender identity when sender_key is present', async () => {
    const senderKey = 'sk-test-1';
    await seedSender(db, mailboxA.mailboxAccountId, senderKey, 'boss@example.com', 'Big Boss');
    await seedActivity(db, {
      mailboxAccountId: mailboxA.mailboxAccountId,
      occurredAt: new Date(NOW_MS - 1 * ONE_DAY_MS),
      source: 'manual',
      action: 'archive',
      senderKey,
    });

    const { rows } = await svc.listActivity({
      mailboxAccountId: mailboxA.mailboxAccountId,
      window: '30d',
      source: null,
      cursor: null,
      limit: 25,
      nowMs: NOW_MS,
    });
    expect(rows[0]!.sender).toEqual({
      senderKey,
      displayName: 'Big Boss',
      email: 'boss@example.com',
      domain: 'example.com',
    });
  });

  it('leaves sender=null for account-scoped rows (no sender_key)', async () => {
    await seedActivity(db, {
      mailboxAccountId: mailboxA.mailboxAccountId,
      occurredAt: new Date(NOW_MS - 1 * ONE_DAY_MS),
      source: 'manual',
      action: 'followup-dismiss',
    });
    const { rows } = await svc.listActivity({
      mailboxAccountId: mailboxA.mailboxAccountId,
      window: '30d',
      source: null,
      cursor: null,
      limit: 25,
      nowMs: NOW_MS,
    });
    expect(rows[0]!.sender).toBeNull();
  });

  describe('D58 — undo state', () => {
    it('resolves to `available` when token exists, not executed, expires in future', async () => {
      const token = await seedUndoToken(db, mailboxA.mailboxAccountId, {
        expiresAt: new Date(NOW_MS + 5 * ONE_DAY_MS),
      });
      await seedActivity(db, {
        mailboxAccountId: mailboxA.mailboxAccountId,
        occurredAt: new Date(NOW_MS - 1 * ONE_DAY_MS),
        source: 'manual',
        action: 'archive',
        undoToken: token,
      });

      const { rows } = await svc.listActivity({
        mailboxAccountId: mailboxA.mailboxAccountId,
        window: '30d',
        source: null,
        cursor: null,
        limit: 25,
        nowMs: NOW_MS,
      });
      expect(rows[0]!.undoState.kind).toBe('available');
      if (rows[0]!.undoState.kind === 'available') {
        expect(rows[0]!.undoState.token).toBe(token);
      }
    });

    it('resolves to `expired` when token exists but expires_at < now', async () => {
      const token = await seedUndoToken(db, mailboxA.mailboxAccountId, {
        expiresAt: new Date(NOW_MS - 1 * ONE_DAY_MS),
      });
      await seedActivity(db, {
        mailboxAccountId: mailboxA.mailboxAccountId,
        occurredAt: new Date(NOW_MS - 8 * ONE_DAY_MS),
        source: 'manual',
        action: 'archive',
        undoToken: token,
      });

      const { rows } = await svc.listActivity({
        mailboxAccountId: mailboxA.mailboxAccountId,
        window: '30d',
        source: null,
        cursor: null,
        limit: 25,
        nowMs: NOW_MS,
      });
      expect(rows[0]!.undoState.kind).toBe('expired');
    });

    it('resolves to `executed` when reverted_at is set', async () => {
      const token = await seedUndoToken(db, mailboxA.mailboxAccountId, {
        expiresAt: new Date(NOW_MS + 5 * ONE_DAY_MS),
        executedAt: new Date(NOW_MS - 1 * ONE_DAY_MS),
        revertedAt: new Date(NOW_MS - 1 * ONE_DAY_MS),
      });
      await seedActivity(db, {
        mailboxAccountId: mailboxA.mailboxAccountId,
        occurredAt: new Date(NOW_MS - 2 * ONE_DAY_MS),
        source: 'manual',
        action: 'archive',
        undoToken: token,
      });

      const { rows } = await svc.listActivity({
        mailboxAccountId: mailboxA.mailboxAccountId,
        window: '30d',
        source: null,
        cursor: null,
        limit: 25,
        nowMs: NOW_MS,
      });
      expect(rows[0]!.undoState.kind).toBe('executed');
    });

    it('resolves to `unavailable` when no token is attached', async () => {
      await seedActivity(db, {
        mailboxAccountId: mailboxA.mailboxAccountId,
        occurredAt: new Date(NOW_MS - 1 * ONE_DAY_MS),
        source: 'manual',
        action: 'keep',
      });
      const { rows } = await svc.listActivity({
        mailboxAccountId: mailboxA.mailboxAccountId,
        window: '30d',
        source: null,
        cursor: null,
        limit: 25,
        nowMs: NOW_MS,
      });
      expect(rows[0]!.undoState.kind).toBe('unavailable');
    });
  });

  describe('D59 — stats aggregation', () => {
    it('counts by verb within the window, ignoring source filter', async () => {
      // 3 archives, 2 unsubscribes, 1 keep, 1 later, 1 followup-dismiss.
      for (let i = 0; i < 3; i++) {
        await seedActivity(db, {
          mailboxAccountId: mailboxA.mailboxAccountId,
          occurredAt: new Date(NOW_MS - (i + 1) * ONE_DAY_MS),
          source: 'manual',
          action: 'archive',
        });
      }
      for (let i = 0; i < 2; i++) {
        await seedActivity(db, {
          mailboxAccountId: mailboxA.mailboxAccountId,
          occurredAt: new Date(NOW_MS - (i + 1) * ONE_DAY_MS),
          source: 'autopilot',
          action: 'unsubscribe',
        });
      }
      await seedActivity(db, {
        mailboxAccountId: mailboxA.mailboxAccountId,
        occurredAt: new Date(NOW_MS - 1 * ONE_DAY_MS),
        source: 'manual',
        action: 'keep',
      });
      await seedActivity(db, {
        mailboxAccountId: mailboxA.mailboxAccountId,
        occurredAt: new Date(NOW_MS - 1 * ONE_DAY_MS),
        source: 'triage',
        action: 'later',
      });
      await seedActivity(db, {
        mailboxAccountId: mailboxA.mailboxAccountId,
        occurredAt: new Date(NOW_MS - 1 * ONE_DAY_MS),
        source: 'manual',
        action: 'followup-dismiss',
      });

      // Pass a source filter that would narrow rows but NOT stats.
      const { stats, rows } = await svc.listActivity({
        mailboxAccountId: mailboxA.mailboxAccountId,
        window: '30d',
        source: 'autopilot',
        cursor: null,
        limit: 25,
        nowMs: NOW_MS,
      });
      // Source-filtered rows: 2 unsubscribes only.
      expect(rows).toHaveLength(2);
      // Stats span the full window across sources.
      expect(stats).toEqual({
        archived: 3,
        deleted: 0,
        unsubscribed: 2,
        kept: 1,
        later: 1,
        followupsDismissed: 1,
        needsAttention: 0,
      });
    });

    it('stats also respect the window boundary', async () => {
      await seedActivity(db, {
        mailboxAccountId: mailboxA.mailboxAccountId,
        occurredAt: new Date(NOW_MS - 60 * ONE_DAY_MS),
        source: 'manual',
        action: 'archive',
      });
      await seedActivity(db, {
        mailboxAccountId: mailboxA.mailboxAccountId,
        occurredAt: new Date(NOW_MS - 1 * ONE_DAY_MS),
        source: 'manual',
        action: 'archive',
      });

      const { stats } = await svc.listActivity({
        mailboxAccountId: mailboxA.mailboxAccountId,
        window: '30d',
        source: null,
        cursor: null,
        limit: 25,
        nowMs: NOW_MS,
      });
      expect(stats.archived).toBe(1);
    });

    it('counts the Delete verb (D227 K/A/U/L/D after ADR-0019)', async () => {
      // 3 deletes + 2 archives + 1 unsubscribe inside the window.
      await seedActivity(db, {
        mailboxAccountId: mailboxA.mailboxAccountId,
        occurredAt: new Date(NOW_MS - 3 * ONE_DAY_MS),
        source: 'manual',
        action: 'delete',
      });
      await seedActivity(db, {
        mailboxAccountId: mailboxA.mailboxAccountId,
        occurredAt: new Date(NOW_MS - 4 * ONE_DAY_MS),
        source: 'manual',
        action: 'delete',
      });
      await seedActivity(db, {
        mailboxAccountId: mailboxA.mailboxAccountId,
        occurredAt: new Date(NOW_MS - 5 * ONE_DAY_MS),
        source: 'autopilot',
        action: 'delete',
      });
      await seedActivity(db, {
        mailboxAccountId: mailboxA.mailboxAccountId,
        occurredAt: new Date(NOW_MS - 2 * ONE_DAY_MS),
        source: 'manual',
        action: 'archive',
      });
      await seedActivity(db, {
        mailboxAccountId: mailboxA.mailboxAccountId,
        occurredAt: new Date(NOW_MS - 6 * ONE_DAY_MS),
        source: 'manual',
        action: 'unsubscribe',
      });

      const { stats } = await svc.listActivity({
        mailboxAccountId: mailboxA.mailboxAccountId,
        window: '30d',
        source: null,
        cursor: null,
        limit: 25,
        nowMs: NOW_MS,
      });
      expect(stats.deleted).toBe(3);
      expect(stats.archived).toBe(1);
      expect(stats.unsubscribed).toBe(1);
    });
  });

  it('returns limit + 1 sentinel rows so controller can detect next page', async () => {
    for (let i = 0; i < 5; i++) {
      await seedActivity(db, {
        mailboxAccountId: mailboxA.mailboxAccountId,
        occurredAt: new Date(NOW_MS - (i + 1) * 60 * 60 * 1000),
        source: 'manual',
        action: 'archive',
      });
    }

    const { rows } = await svc.listActivity({
      mailboxAccountId: mailboxA.mailboxAccountId,
      window: '30d',
      source: null,
      cursor: null,
      limit: 3,
      nowMs: NOW_MS,
    });
    // 5 rows seeded, limit 3 → returns 4 (limit+1 sentinel).
    expect(rows).toHaveLength(4);
  });

  it('cursor returns the next page strictly-after the prior boundary', async () => {
    const stamps = [10, 8, 6, 4, 2].map((h) => new Date(NOW_MS - h * 60 * 60 * 1000));
    for (const occurredAt of stamps) {
      await seedActivity(db, {
        mailboxAccountId: mailboxA.mailboxAccountId,
        occurredAt,
        source: 'manual',
        action: 'archive',
      });
    }
    // First page (newest 2)
    const { rows: page1 } = await svc.listActivity({
      mailboxAccountId: mailboxA.mailboxAccountId,
      window: '30d',
      source: null,
      cursor: null,
      limit: 2,
      nowMs: NOW_MS,
    });
    const visible1 = page1.slice(0, 2);
    expect(visible1.map((r) => r.occurredAt)).toEqual([
      stamps[4]!.toISOString(),
      stamps[3]!.toISOString(),
    ]);

    // Cursor → next page starts strictly after visible1's last row.
    const last = visible1[visible1.length - 1]!;
    const { rows: page2 } = await svc.listActivity({
      mailboxAccountId: mailboxA.mailboxAccountId,
      window: '30d',
      source: null,
      cursor: { occurredAt: new Date(last.occurredAt), id: last.id },
      limit: 2,
      nowMs: NOW_MS,
    });
    const visible2 = page2.slice(0, 2);
    expect(visible2.map((r) => r.occurredAt)).toEqual([
      stamps[2]!.toISOString(),
      stamps[1]!.toISOString(),
    ]);
  });
});
