import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import {
  activityLog,
  automationRules,
  mailMessages,
  mailboxAccounts,
  schema,
  senders,
  undoJournal,
  users,
  workspaces,
} from '@declutrmail/db';
import { eq } from 'drizzle-orm';
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
    action:
      | 'keep'
      | 'archive'
      | 'unsubscribe'
      | 'unsubscribe_confirmed'
      | 'unsubscribe_endpoint_accepted'
      | 'unsubscribe_failed'
      | 'unsubscribe_unconfirmed'
      | 'unsubscribe_action_required'
      | 'unsubscribe_draft_opened'
      | 'unsubscribe_user_marked_sent'
      | 'unsubscribe_unavailable'
      | 'later'
      | 'delete'
      | 'followup-dismiss';
    affectedCount?: number;
    senderKey?: string;
    undoToken?: string;
    ruleId?: string;
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
      ...(args.ruleId ? { ruleId: args.ruleId } : {}),
    })
    .returning({ id: activityLog.id });
  return row!.id;
}

/** Seed one preset Autopilot rule (D57 attribution fixture). */
async function seedRule(db: Db, mailboxAccountId: string, name: string): Promise<string> {
  const [row] = await db
    .insert(automationRules)
    .values({
      mailboxAccountId,
      presetKey: 'newsletter_graveyard',
      isPreset: true,
      name,
      actionKind: 'archive',
    })
    .returning({ id: automationRules.id });
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
        // The seeded deflecting rows carry no sender_key → zero
        // deflected senders → null (nothing to project).
        noisePreventedPerMonth: null,
      });
    });

    it('noisePreventedPerMonth — deflected senders project last-90d volume to per-month; null with no deflections (D33)', async () => {
      const { mailboxAccountId } = await seedMailbox(db, 'noise@x.test');
      const senderKey = 'n'.repeat(64);
      await seedSender(db, mailboxAccountId, senderKey, 'noisy@brand.test', 'Noisy Brand');
      // 9 inbound messages in the last 90d → round(9/3) = 3/mo.
      const now = Date.now();
      await db.insert(mailMessages).values(
        Array.from({ length: 9 }, (_, i) => ({
          mailboxAccountId,
          providerMessageId: `noise-${i}`,
          providerThreadId: `t-noise-${i}`,
          senderKey,
          subject: '',
          snippet: '',
          internalDate: new Date(now - (i + 1) * 86_400_000),
          labelIds: ['INBOX'],
          isUnread: true,
        })),
      );

      // No deflecting decisions yet → null (nothing to project).
      const before = await svc.listActivity({
        mailboxAccountId,
        window: '30d',
        source: null,
        cursor: null,
        limit: 25,
        nowMs: Date.now(),
      });
      expect(before.stats.noisePreventedPerMonth).toBeNull();

      await seedActivity(db, {
        mailboxAccountId,
        occurredAt: new Date(),
        source: 'triage',
        action: 'unsubscribe',
        senderKey,
      });
      const after = await svc.listActivity({
        mailboxAccountId,
        window: '30d',
        source: null,
        cursor: null,
        limit: 25,
        nowMs: Date.now(),
      });
      expect(after.stats.noisePreventedPerMonth).toBe(3);
    });

    it('D56 — unsubscribe_confirmed is a distinct feed row that does NOT double-count the intent', async () => {
      // A one-click unsubscribe writes TWO rows: the intent (the click)
      // and the worker's confirmed OUTCOME. Both must appear in the feed,
      // but the K/A/U/L/D stats must count the DECISION once — the
      // confirmed row is an outcome annotation, not a second unsubscribe.
      const senderKey = 'a'.repeat(64);
      await seedActivity(db, {
        mailboxAccountId: mailboxA.mailboxAccountId,
        occurredAt: new Date(NOW_MS - 2 * ONE_DAY_MS),
        source: 'manual',
        action: 'unsubscribe',
        affectedCount: 0,
        senderKey,
      });
      await seedActivity(db, {
        mailboxAccountId: mailboxA.mailboxAccountId,
        occurredAt: new Date(NOW_MS - 1 * ONE_DAY_MS),
        source: 'manual',
        action: 'unsubscribe_confirmed',
        affectedCount: 0,
        senderKey,
      });

      const { stats, rows } = await svc.listActivity({
        mailboxAccountId: mailboxA.mailboxAccountId,
        window: '30d',
        source: null,
        cursor: null,
        limit: 25,
        nowMs: NOW_MS,
      });
      // Both rows surface in the timeline, newest first.
      expect(rows.map((r) => r.action)).toEqual(['unsubscribe_confirmed', 'unsubscribe']);
      // Stats count the decision ONCE — the confirmed row is excluded
      // from the `unsubscribed` bucket (it is not the `unsubscribe` verb).
      expect(stats.unsubscribed).toBe(1);
    });

    it('surfaces failed/unconfirmed unsubscribe outcomes as needing attention', async () => {
      const senderKey = 'f'.repeat(64);
      for (const [action, daysAgo] of [
        ['unsubscribe', 3],
        ['unsubscribe_failed', 2],
        ['unsubscribe_unconfirmed', 1],
      ] as const) {
        await seedActivity(db, {
          mailboxAccountId: mailboxA.mailboxAccountId,
          occurredAt: new Date(NOW_MS - daysAgo * ONE_DAY_MS),
          source: 'manual',
          action,
          affectedCount: 0,
          senderKey,
        });
      }

      const { stats, rows } = await svc.listActivity({
        mailboxAccountId: mailboxA.mailboxAccountId,
        window: '30d',
        source: null,
        cursor: null,
        limit: 25,
        nowMs: NOW_MS,
      });
      expect(rows.map((r) => r.action)).toEqual([
        'unsubscribe_unconfirmed',
        'unsubscribe_failed',
        'unsubscribe',
      ]);
      expect(stats.unsubscribed).toBe(1);
      expect(stats.needsAttention).toBe(2);
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

  // ── B-track Activity power-options ───────────────────────────────────

  describe('verb filter (multi-select)', () => {
    it('narrows rows to a single verb', async () => {
      await seedActivity(db, {
        mailboxAccountId: mailboxA.mailboxAccountId,
        occurredAt: new Date(NOW_MS - 1 * ONE_DAY_MS),
        source: 'manual',
        action: 'archive',
      });
      await seedActivity(db, {
        mailboxAccountId: mailboxA.mailboxAccountId,
        occurredAt: new Date(NOW_MS - 2 * ONE_DAY_MS),
        source: 'manual',
        action: 'delete',
      });
      await seedActivity(db, {
        mailboxAccountId: mailboxA.mailboxAccountId,
        occurredAt: new Date(NOW_MS - 3 * ONE_DAY_MS),
        source: 'manual',
        action: 'unsubscribe',
      });

      const { rows } = await svc.listActivity({
        mailboxAccountId: mailboxA.mailboxAccountId,
        window: '30d',
        source: null,
        verbs: ['delete'],
        cursor: null,
        limit: 25,
        nowMs: NOW_MS,
      });
      expect(rows.map((r) => r.action)).toEqual(['delete']);
    });

    it('accepts a multi-verb subset', async () => {
      for (const action of ['archive', 'delete', 'unsubscribe', 'keep'] as const) {
        await seedActivity(db, {
          mailboxAccountId: mailboxA.mailboxAccountId,
          occurredAt: new Date(NOW_MS - 1 * ONE_DAY_MS),
          source: 'manual',
          action,
        });
      }
      const { rows } = await svc.listActivity({
        mailboxAccountId: mailboxA.mailboxAccountId,
        window: '30d',
        source: null,
        verbs: ['archive', 'delete'],
        cursor: null,
        limit: 25,
        nowMs: NOW_MS,
      });
      expect(rows.map((r) => r.action).sort()).toEqual(['archive', 'delete']);
    });

    it('window-stats stay independent of the verb filter (D59 contract preserved)', async () => {
      await seedActivity(db, {
        mailboxAccountId: mailboxA.mailboxAccountId,
        occurredAt: new Date(NOW_MS - 1 * ONE_DAY_MS),
        source: 'manual',
        action: 'archive',
      });
      await seedActivity(db, {
        mailboxAccountId: mailboxA.mailboxAccountId,
        occurredAt: new Date(NOW_MS - 1 * ONE_DAY_MS),
        source: 'manual',
        action: 'delete',
      });
      const { stats } = await svc.listActivity({
        mailboxAccountId: mailboxA.mailboxAccountId,
        window: '30d',
        source: null,
        verbs: ['delete'],
        cursor: null,
        limit: 25,
        nowMs: NOW_MS,
      });
      // Stats answer "what HAPPENED in this window", not "what's visible";
      // the verb filter narrows rows but stats still count both verbs.
      expect(stats.archived).toBe(1);
      expect(stats.deleted).toBe(1);
    });
  });

  describe('sender_q search', () => {
    beforeEach(async () => {
      await seedSender(
        db,
        mailboxA.mailboxAccountId,
        'sender-aber',
        'aber@em.abercrombie.com',
        'Abercrombie',
      );
      await seedSender(db, mailboxA.mailboxAccountId, 'sender-dkny', 'newsletter@dkny.com', 'DKNY');
      await seedActivity(db, {
        mailboxAccountId: mailboxA.mailboxAccountId,
        occurredAt: new Date(NOW_MS - 1 * ONE_DAY_MS),
        source: 'manual',
        action: 'delete',
        senderKey: 'sender-aber',
      });
      await seedActivity(db, {
        mailboxAccountId: mailboxA.mailboxAccountId,
        occurredAt: new Date(NOW_MS - 2 * ONE_DAY_MS),
        source: 'manual',
        action: 'delete',
        senderKey: 'sender-dkny',
      });
    });

    it('matches a display-name substring case-insensitively', async () => {
      const { rows } = await svc.listActivity({
        mailboxAccountId: mailboxA.mailboxAccountId,
        window: '30d',
        source: null,
        senderQuery: 'aber',
        cursor: null,
        limit: 25,
        nowMs: NOW_MS,
      });
      expect(rows.map((r) => r.sender?.displayName)).toEqual(['Abercrombie']);
    });

    it('matches an email substring case-insensitively', async () => {
      const { rows } = await svc.listActivity({
        mailboxAccountId: mailboxA.mailboxAccountId,
        window: '30d',
        source: null,
        senderQuery: 'DKNY.COM',
        cursor: null,
        limit: 25,
        nowMs: NOW_MS,
      });
      expect(rows.map((r) => r.sender?.displayName)).toEqual(['DKNY']);
    });

    it('escapes ILIKE wildcards so % is a literal match', async () => {
      // No sender's name contains a literal %, so the wildcard-escape
      // run must return zero rows (without the escape, `%` would match
      // every row).
      const { rows } = await svc.listActivity({
        mailboxAccountId: mailboxA.mailboxAccountId,
        window: '30d',
        source: null,
        senderQuery: '%',
        cursor: null,
        limit: 25,
        nowMs: NOW_MS,
      });
      expect(rows).toHaveLength(0);
    });
  });

  describe('date_from / date_to custom range', () => {
    beforeEach(async () => {
      // Drop one activity row at each of -3d / -10d / -45d.
      for (const days of [3, 10, 45]) {
        await seedActivity(db, {
          mailboxAccountId: mailboxA.mailboxAccountId,
          occurredAt: new Date(NOW_MS - days * ONE_DAY_MS),
          source: 'manual',
          action: 'archive',
        });
      }
    });

    it('dateFrom alone replaces the window-derived lower bound', async () => {
      // window=30d would exclude the -45d row; dateFrom=-60d INCLUDES it.
      const { rows } = await svc.listActivity({
        mailboxAccountId: mailboxA.mailboxAccountId,
        window: '30d',
        source: null,
        dateFrom: new Date(NOW_MS - 60 * ONE_DAY_MS),
        cursor: null,
        limit: 25,
        nowMs: NOW_MS,
      });
      expect(rows).toHaveLength(3);
    });

    it('dateTo enforces a strict upper bound', async () => {
      // -3d row excluded; -10d + -45d remain (no lower bound).
      const { rows } = await svc.listActivity({
        mailboxAccountId: mailboxA.mailboxAccountId,
        window: '30d',
        source: null,
        dateTo: new Date(NOW_MS - 5 * ONE_DAY_MS),
        cursor: null,
        limit: 25,
        nowMs: NOW_MS,
      });
      expect(rows).toHaveLength(2);
    });
  });

  describe('all-time stats', () => {
    it('counts every row ever, ignoring window + verb + sender + date filters', async () => {
      // 2 archives 2d ago + 3 deletes 100d ago (outside any 30d window).
      for (let i = 0; i < 2; i++) {
        await seedActivity(db, {
          mailboxAccountId: mailboxA.mailboxAccountId,
          occurredAt: new Date(NOW_MS - 2 * ONE_DAY_MS),
          source: 'manual',
          action: 'archive',
        });
      }
      for (let i = 0; i < 3; i++) {
        await seedActivity(db, {
          mailboxAccountId: mailboxA.mailboxAccountId,
          occurredAt: new Date(NOW_MS - 100 * ONE_DAY_MS),
          source: 'manual',
          action: 'delete',
        });
      }

      const { stats, allTimeStats } = await svc.listActivity({
        mailboxAccountId: mailboxA.mailboxAccountId,
        window: '30d',
        source: null,
        verbs: ['archive'],
        cursor: null,
        limit: 25,
        nowMs: NOW_MS,
      });
      // 30d-window stats: only the 2 archives are inside the window.
      expect(stats.archived).toBe(2);
      expect(stats.deleted).toBe(0);
      // All-time stats include the 100d-old deletes.
      expect(allTimeStats.archived).toBe(2);
      expect(allTimeStats.deleted).toBe(3);
    });

    it('isolates all-time stats per mailbox (tenant safety)', async () => {
      await seedActivity(db, {
        mailboxAccountId: mailboxA.mailboxAccountId,
        occurredAt: new Date(NOW_MS - 2 * ONE_DAY_MS),
        source: 'manual',
        action: 'archive',
      });
      await seedActivity(db, {
        mailboxAccountId: mailboxB.mailboxAccountId,
        occurredAt: new Date(NOW_MS - 2 * ONE_DAY_MS),
        source: 'manual',
        action: 'archive',
      });
      const { allTimeStats: aStats } = await svc.listActivity({
        mailboxAccountId: mailboxA.mailboxAccountId,
        window: '30d',
        source: null,
        cursor: null,
        limit: 25,
        nowMs: NOW_MS,
      });
      const { allTimeStats: bStats } = await svc.listActivity({
        mailboxAccountId: mailboxB.mailboxAccountId,
        window: '30d',
        source: null,
        cursor: null,
        limit: 25,
        nowMs: NOW_MS,
      });
      expect(aStats.archived).toBe(1);
      expect(bStats.archived).toBe(1);
    });
  });

  // ── D57 — rule attribution (U27) ─────────────────────────────────────

  describe('D57 — rule attribution', () => {
    it('joins rule id + name for autopilot rows carrying a rule_id', async () => {
      const ruleId = await seedRule(db, mailboxA.mailboxAccountId, 'Newsletter graveyard');
      await seedActivity(db, {
        mailboxAccountId: mailboxA.mailboxAccountId,
        occurredAt: new Date(NOW_MS - 1 * ONE_DAY_MS),
        source: 'autopilot',
        action: 'archive',
        ruleId,
      });

      const { rows } = await svc.listActivity({
        mailboxAccountId: mailboxA.mailboxAccountId,
        window: '30d',
        source: null,
        cursor: null,
        limit: 25,
        nowMs: NOW_MS,
      });
      expect(rows[0]!.rule).toEqual({ id: ruleId, name: 'Newsletter graveyard' });
    });

    it('leaves rule=null for rows without a rule_id (manual / triage)', async () => {
      await seedActivity(db, {
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
      expect(rows[0]!.rule).toBeNull();
    });

    it('degrades rule to null when the originating rule is deleted (FK set-null)', async () => {
      const ruleId = await seedRule(db, mailboxA.mailboxAccountId, 'Auto-archive low engagement');
      await seedActivity(db, {
        mailboxAccountId: mailboxA.mailboxAccountId,
        occurredAt: new Date(NOW_MS - 1 * ONE_DAY_MS),
        source: 'autopilot',
        action: 'archive',
        ruleId,
      });
      await db.delete(automationRules).where(eq(automationRules.id, ruleId));

      const { rows } = await svc.listActivity({
        mailboxAccountId: mailboxA.mailboxAccountId,
        window: '30d',
        source: null,
        cursor: null,
        limit: 25,
        nowMs: NOW_MS,
      });
      // The append-only audit row survives the rule's deletion; the
      // attribution degrades to null (FE renders plain "by Autopilot").
      expect(rows[0]!.source).toBe('autopilot');
      expect(rows[0]!.rule).toBeNull();
    });
  });

  // ── DQ16 — summary aggregate (share receipt) ─────────────────────────

  describe('summarizeActivity (DQ16 share receipt)', () => {
    it('counts ONLY the current mailbox — decisions + undos seeded in both mailboxes', async () => {
      // Both mailboxes (distinct users/workspaces via seedMailbox) get
      // decisions under the SAME sender_key strings — sender_key is
      // per-mailbox namespaced, so a query that lost the mailbox
      // predicate would inflate every field below and fail.
      for (const senderKey of ['sk-shared-1', 'sk-shared-2']) {
        await seedActivity(db, {
          mailboxAccountId: mailboxA.mailboxAccountId,
          occurredAt: new Date(NOW_MS - 2 * ONE_DAY_MS),
          source: 'triage',
          action: 'archive',
          affectedCount: 10,
          senderKey,
        });
        await seedActivity(db, {
          mailboxAccountId: mailboxB.mailboxAccountId,
          occurredAt: new Date(NOW_MS - 2 * ONE_DAY_MS),
          source: 'triage',
          action: 'archive',
          affectedCount: 100,
          senderKey,
        });
      }
      await seedActivity(db, {
        mailboxAccountId: mailboxB.mailboxAccountId,
        occurredAt: new Date(NOW_MS - 1 * ONE_DAY_MS),
        source: 'manual',
        action: 'delete',
        affectedCount: 100,
        senderKey: 'sk-b-only',
      });
      // One reverted undo in EACH mailbox.
      await seedUndoToken(db, mailboxA.mailboxAccountId, {
        expiresAt: new Date(NOW_MS + 5 * ONE_DAY_MS),
        executedAt: new Date(NOW_MS - 1 * ONE_DAY_MS),
        revertedAt: new Date(NOW_MS - 1 * ONE_DAY_MS),
      });
      await seedUndoToken(db, mailboxB.mailboxAccountId, {
        expiresAt: new Date(NOW_MS + 5 * ONE_DAY_MS),
        executedAt: new Date(NOW_MS - 1 * ONE_DAY_MS),
        revertedAt: new Date(NOW_MS - 1 * ONE_DAY_MS),
      });

      const a = await svc.summarizeActivity({
        mailboxAccountId: mailboxA.mailboxAccountId,
        window: '30d',
        nowMs: NOW_MS,
      });
      expect(a.byVerb).toEqual({ keep: 0, archive: 2, unsubscribe: 0, later: 0, delete: 0 });
      expect(a.decidedSenders).toBe(2);
      expect(a.emailsHandled).toBe(20);
      expect(a.undoCount).toBe(1);

      const b = await svc.summarizeActivity({
        mailboxAccountId: mailboxB.mailboxAccountId,
        window: '30d',
        nowMs: NOW_MS,
      });
      expect(b.byVerb).toEqual({ keep: 0, archive: 2, unsubscribe: 0, later: 0, delete: 1 });
      expect(b.decidedSenders).toBe(3);
      expect(b.emailsHandled).toBe(300);
      expect(b.undoCount).toBe(1);
    });

    it('aggregates byVerb + emailsHandled across all five canonical verbs; non-canonical actions excluded', async () => {
      const verbs = [
        { action: 'keep', affectedCount: 0, daysAgo: 1 },
        { action: 'archive', affectedCount: 12, daysAgo: 2 },
        { action: 'unsubscribe', affectedCount: 3, daysAgo: 3 },
        { action: 'later', affectedCount: 4, daysAgo: 4 },
        { action: 'delete', affectedCount: 6, daysAgo: 5 },
      ] as const;
      for (const [i, v] of verbs.entries()) {
        await seedActivity(db, {
          mailboxAccountId: mailboxA.mailboxAccountId,
          occurredAt: new Date(NOW_MS - v.daysAgo * ONE_DAY_MS),
          source: 'manual',
          action: v.action,
          affectedCount: v.affectedCount,
          senderKey: `sk-${i}`,
        });
      }
      // OLDEST row is non-canonical — must be excluded from byVerb,
      // emailsHandled, decidedSenders AND `since`.
      await seedActivity(db, {
        mailboxAccountId: mailboxA.mailboxAccountId,
        occurredAt: new Date(NOW_MS - 20 * ONE_DAY_MS),
        source: 'manual',
        action: 'followup-dismiss',
        affectedCount: 7,
        senderKey: 'sk-followup',
      });

      const summary = await svc.summarizeActivity({
        mailboxAccountId: mailboxA.mailboxAccountId,
        window: '30d',
        nowMs: NOW_MS,
      });
      expect(summary.byVerb).toEqual({ keep: 1, archive: 1, unsubscribe: 1, later: 1, delete: 1 });
      expect(summary.emailsHandled).toBe(25);
      expect(summary.decidedSenders).toBe(5);
      // `since` = earliest CANONICAL row (-5d delete), not the -20d
      // followup-dismiss row.
      expect(summary.since).toBe(new Date(NOW_MS - 5 * ONE_DAY_MS).toISOString());
      expect(summary.window).toBe('30d');
    });

    it('decidedSenders dedupes a sender decided under multiple verbs; null sender_key rows never count', async () => {
      // Same sender: archived, then later'd.
      for (const action of ['archive', 'later'] as const) {
        await seedActivity(db, {
          mailboxAccountId: mailboxA.mailboxAccountId,
          occurredAt: new Date(NOW_MS - 1 * ONE_DAY_MS),
          source: 'manual',
          action,
          senderKey: 'sk-same',
        });
      }
      // Account-scoped canonical row (no sender_key).
      await seedActivity(db, {
        mailboxAccountId: mailboxA.mailboxAccountId,
        occurredAt: new Date(NOW_MS - 1 * ONE_DAY_MS),
        source: 'manual',
        action: 'archive',
      });

      const summary = await svc.summarizeActivity({
        mailboxAccountId: mailboxA.mailboxAccountId,
        window: '30d',
        nowMs: NOW_MS,
      });
      expect(summary.decidedSenders).toBe(1);
      expect(summary.byVerb.archive).toBe(2);
      expect(summary.byVerb.later).toBe(1);
    });

    it('window bound: 7d excludes older rows; all includes them and moves `since` back', async () => {
      await seedActivity(db, {
        mailboxAccountId: mailboxA.mailboxAccountId,
        occurredAt: new Date(NOW_MS - 3 * ONE_DAY_MS),
        source: 'manual',
        action: 'archive',
        affectedCount: 2,
        senderKey: 'sk-recent',
      });
      await seedActivity(db, {
        mailboxAccountId: mailboxA.mailboxAccountId,
        occurredAt: new Date(NOW_MS - 20 * ONE_DAY_MS),
        source: 'manual',
        action: 'delete',
        affectedCount: 9,
        senderKey: 'sk-old',
      });

      const week = await svc.summarizeActivity({
        mailboxAccountId: mailboxA.mailboxAccountId,
        window: '7d',
        nowMs: NOW_MS,
      });
      expect(week.byVerb.archive).toBe(1);
      expect(week.byVerb.delete).toBe(0);
      expect(week.emailsHandled).toBe(2);
      expect(week.decidedSenders).toBe(1);
      expect(week.since).toBe(new Date(NOW_MS - 3 * ONE_DAY_MS).toISOString());

      const all = await svc.summarizeActivity({
        mailboxAccountId: mailboxA.mailboxAccountId,
        window: 'all',
        nowMs: NOW_MS,
      });
      expect(all.byVerb.delete).toBe(1);
      expect(all.emailsHandled).toBe(11);
      expect(all.decidedSenders).toBe(2);
      expect(all.since).toBe(new Date(NOW_MS - 20 * ONE_DAY_MS).toISOString());
    });

    it('undoCount counts REVERTED journal rows only, bounded by reverted_at', async () => {
      // Reverted 2d ago — inside 7d.
      await seedUndoToken(db, mailboxA.mailboxAccountId, {
        expiresAt: new Date(NOW_MS + 5 * ONE_DAY_MS),
        executedAt: new Date(NOW_MS - 2 * ONE_DAY_MS),
        revertedAt: new Date(NOW_MS - 2 * ONE_DAY_MS),
      });
      // Reverted 10d ago — outside 7d, inside all.
      await seedUndoToken(db, mailboxA.mailboxAccountId, {
        expiresAt: new Date(NOW_MS - 3 * ONE_DAY_MS),
        executedAt: new Date(NOW_MS - 10 * ONE_DAY_MS),
        revertedAt: new Date(NOW_MS - 10 * ONE_DAY_MS),
      });
      // Live token, never reverted — never counts.
      await seedUndoToken(db, mailboxA.mailboxAccountId, {
        expiresAt: new Date(NOW_MS + 5 * ONE_DAY_MS),
      });
      // Revert triggered but never confirmed (executed_at set,
      // reverted_at null) — not a completed undo; never counts.
      await seedUndoToken(db, mailboxA.mailboxAccountId, {
        expiresAt: new Date(NOW_MS + 5 * ONE_DAY_MS),
        executedAt: new Date(NOW_MS - 1 * ONE_DAY_MS),
      });

      const week = await svc.summarizeActivity({
        mailboxAccountId: mailboxA.mailboxAccountId,
        window: '7d',
        nowMs: NOW_MS,
      });
      expect(week.undoCount).toBe(1);

      const all = await svc.summarizeActivity({
        mailboxAccountId: mailboxA.mailboxAccountId,
        window: 'all',
        nowMs: NOW_MS,
      });
      expect(all.undoCount).toBe(2);
    });

    it('returns zeros + since=null for a mailbox with no activity', async () => {
      const summary = await svc.summarizeActivity({
        mailboxAccountId: mailboxA.mailboxAccountId,
        window: '30d',
        nowMs: NOW_MS,
      });
      expect(summary).toEqual({
        window: '30d',
        since: null,
        decidedSenders: 0,
        byVerb: { keep: 0, archive: 0, unsubscribe: 0, later: 0, delete: 0 },
        emailsHandled: 0,
        undoCount: 0,
      });
    });
  });
});
