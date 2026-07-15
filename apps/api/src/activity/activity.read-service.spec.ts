import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import {
  actionJobs,
  activityLog,
  automationRules,
  mailMessages,
  mailboxAccounts,
  productFeedback,
  ruleMatchLog,
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

/**
 * Every parameter array the drizzle session hands to the driver. PGlite
 * serializes JS Dates itself, but postgres.js (dev/prod) throws when a
 * Date is bound next to a raw `sql` expression — so specs assert against
 * this log to keep the two drivers behaviorally equivalent.
 */
const driverParamLog: unknown[][] = [];

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
  const originalQuery = pg.query.bind(pg);
  pg.query = (async (...args: Parameters<typeof originalQuery>) => {
    if (Array.isArray(args[1])) driverParamLog.push(args[1]);
    return originalQuery(...args);
  }) as typeof pg.query;
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
  return { workspaceId: ws!.id, userId: user!.id, mailboxAccountId: mb!.id };
}

async function seedSender(
  db: Db,
  mailboxAccountId: string,
  senderKey: string,
  email: string,
  displayName: string,
): Promise<string> {
  const at = email.lastIndexOf('@');
  const domain = at === -1 ? email : email.slice(at + 1);
  const [sender] = await db
    .insert(senders)
    .values({
      mailboxAccountId,
      senderKey,
      email,
      displayName,
      domain,
      gmailCategory: 'primary',
      firstSeenAt: new Date(NOW_MS - 30 * ONE_DAY_MS),
      lastSeenAt: new Date(NOW_MS - 1 * ONE_DAY_MS),
    })
    .returning({ id: senders.id });
  return sender!.id;
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
    actionJobId?: string;
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
      ...(args.actionJobId ? { actionJobId: args.actionJobId } : {}),
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

let actionKeySequence = 0;

async function seedExecutionAttempt(
  db: Db,
  args: {
    mailboxAccountId: string;
    senderId: string;
    senderKey: string;
    verb?: 'archive' | 'later' | 'delete';
    status: 'queued' | 'executing' | 'done' | 'failed';
    requestedCount?: number;
    errorCode?: string | null;
    createdAt: Date;
    rootActionId?: string | null;
    retryOfActionId?: string | null;
    recoveryAttempt?: number;
  },
): Promise<string> {
  actionKeySequence += 1;
  const verb = args.verb ?? 'archive';
  const [row] = await db
    .insert(actionJobs)
    .values({
      mailboxAccountId: args.mailboxAccountId,
      verb,
      direction: 'forward',
      selector: { type: 'sender', senderId: args.senderId, senderKey: args.senderKey },
      resolvedMessageIds: [`message-${actionKeySequence}`],
      requestedCount: args.requestedCount ?? 1,
      status: args.status,
      idempotencyKey: `activity-execution-${actionKeySequence}`,
      errorCode: args.errorCode ?? null,
      createdAt: args.createdAt,
      updatedAt: args.createdAt,
      rootActionId: args.rootActionId ?? null,
      retryOfActionId: args.retryOfActionId ?? null,
      recoveryAttempt: args.recoveryAttempt ?? 0,
      ...((args.recoveryAttempt ?? 0) > 0 ? { selectionFrozenAt: args.createdAt } : {}),
      ...(verb === 'later' ? { wakeAt: new Date(NOW_MS + 7 * ONE_DAY_MS) } : {}),
    })
    .returning({ id: actionJobs.id });
  return row!.id;
}

describe('ActivityReadService', () => {
  let db: Db;
  let svc: ActivityReadService;
  let mailboxA: { workspaceId: string; userId: string; mailboxAccountId: string };
  let mailboxB: { workspaceId: string; userId: string; mailboxAccountId: string };

  beforeEach(async () => {
    actionKeySequence = 0;
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
    expect(rows[0]!.executionState).toBeNull();
  });

  it('projects only the current user rating onto an automatic Activity row', async () => {
    const activityId = await seedActivity(db, {
      mailboxAccountId: mailboxA.mailboxAccountId,
      occurredAt: new Date(NOW_MS - ONE_DAY_MS),
      source: 'autopilot',
      action: 'archive',
    });
    await db.insert(productFeedback).values({
      workspaceId: mailboxA.workspaceId,
      userId: mailboxA.userId,
      mailboxAccountId: mailboxA.mailboxAccountId,
      surface: 'activity',
      rating: 'surprising',
      activityLogId: activityId,
    });

    const { rows } = await svc.listActivity({
      mailboxAccountId: mailboxA.mailboxAccountId,
      userId: mailboxA.userId,
      window: '30d',
      source: null,
      cursor: null,
      limit: 25,
      nowMs: NOW_MS,
    });
    expect(rows[0]!.feedbackRating).toBe('surprising');
  });

  describe('action execution projection', () => {
    it('merges an unresolved root action into chronological Activity with current sender facts', async () => {
      const senderKey = 'execution-sender-a';
      const senderId = await seedSender(
        db,
        mailboxA.mailboxAccountId,
        senderKey,
        'news@example.com',
        'Daily News',
      );
      const activityId = await seedActivity(db, {
        mailboxAccountId: mailboxA.mailboxAccountId,
        occurredAt: new Date(NOW_MS - 4 * 60 * 60 * 1000),
        source: 'manual',
        action: 'keep',
        senderKey,
      });
      const actionId = await seedExecutionAttempt(db, {
        mailboxAccountId: mailboxA.mailboxAccountId,
        senderId,
        senderKey,
        status: 'queued',
        requestedCount: 8,
        createdAt: new Date(NOW_MS - 2 * 60 * 60 * 1000),
      });

      const { rows } = await svc.listActivity({
        mailboxAccountId: mailboxA.mailboxAccountId,
        window: '30d',
        source: null,
        cursor: null,
        limit: 25,
        nowMs: NOW_MS,
      });

      expect(rows.map((row) => row.id)).toEqual([actionId, activityId]);
      expect(rows[0]).toMatchObject({
        source: 'manual',
        action: 'archive',
        affectedCount: 0,
        sender: { senderKey, displayName: 'Daily News', email: 'news@example.com' },
        undoState: { kind: 'unavailable' },
        executionState: {
          kind: 'in_progress',
          actionId,
          requestedCount: 8,
          isRecovery: false,
          status: 'queued',
        },
      });
      expect(rows[1]!.executionState).toBeNull();
    });

    it('uses the latest recovery attempt and removes a lineage after any recovery succeeds', async () => {
      const senderKey = 'execution-recovery';
      const senderId = await seedSender(
        db,
        mailboxA.mailboxAccountId,
        senderKey,
        'retry@example.com',
        'Retry Sender',
      );
      const rootActionId = await seedExecutionAttempt(db, {
        mailboxAccountId: mailboxA.mailboxAccountId,
        senderId,
        senderKey,
        verb: 'delete',
        status: 'failed',
        errorCode: 'TransientError',
        requestedCount: 5,
        createdAt: new Date(NOW_MS - 3 * ONE_DAY_MS),
      });
      const firstRecoveryId = await seedExecutionAttempt(db, {
        mailboxAccountId: mailboxA.mailboxAccountId,
        senderId,
        senderKey,
        verb: 'delete',
        status: 'failed',
        errorCode: 'PermanentError',
        requestedCount: 4,
        createdAt: new Date(NOW_MS - ONE_DAY_MS),
        rootActionId,
        retryOfActionId: rootActionId,
        recoveryAttempt: 1,
      });
      const currentActionId = await seedExecutionAttempt(db, {
        mailboxAccountId: mailboxA.mailboxAccountId,
        senderId,
        senderKey,
        verb: 'delete',
        status: 'executing',
        requestedCount: 3,
        // Attempt number, not wall-clock ordering, chooses current state.
        createdAt: new Date(NOW_MS - 2 * ONE_DAY_MS),
        rootActionId,
        retryOfActionId: firstRecoveryId,
        recoveryAttempt: 2,
      });

      const active = await svc.listActivity({
        mailboxAccountId: mailboxA.mailboxAccountId,
        window: '30d',
        source: null,
        cursor: null,
        limit: 25,
        nowMs: NOW_MS,
      });
      expect(active.rows).toHaveLength(1);
      expect(active.rows[0]!.executionState).toEqual({
        kind: 'in_progress',
        actionId: currentActionId,
        requestedCount: 3,
        isRecovery: true,
        status: 'executing',
      });
      expect(active.stats.needsAttention).toBe(0);

      await db.update(actionJobs).set({ status: 'done' }).where(eq(actionJobs.id, currentActionId));
      const resolved = await svc.listActivity({
        mailboxAccountId: mailboxA.mailboxAccountId,
        window: '30d',
        source: null,
        cursor: null,
        limit: 25,
        nowMs: NOW_MS,
      });
      expect(resolved.rows).toHaveLength(0);
      expect(resolved.stats.needsAttention).toBe(0);
    });

    it('counts each failed lineage once and derives its recovery resolution from the latest error', async () => {
      const senderKey = 'execution-failed';
      const senderId = await seedSender(
        db,
        mailboxA.mailboxAccountId,
        senderKey,
        'failure@example.com',
        'Failure Sender',
      );
      const rootActionId = await seedExecutionAttempt(db, {
        mailboxAccountId: mailboxA.mailboxAccountId,
        senderId,
        senderKey,
        status: 'failed',
        errorCode: 'InvalidGrantError',
        requestedCount: 9,
        createdAt: new Date(NOW_MS - 2 * ONE_DAY_MS),
      });
      const recoveryId = await seedExecutionAttempt(db, {
        mailboxAccountId: mailboxA.mailboxAccountId,
        senderId,
        senderKey,
        status: 'failed',
        errorCode: 'TransientError',
        requestedCount: 6,
        createdAt: new Date(NOW_MS - ONE_DAY_MS),
        rootActionId,
        retryOfActionId: rootActionId,
        recoveryAttempt: 1,
      });
      await seedActivity(db, {
        mailboxAccountId: mailboxA.mailboxAccountId,
        occurredAt: new Date(NOW_MS - ONE_DAY_MS),
        source: 'manual',
        action: 'unsubscribe_failed',
        senderKey,
      });

      const result = await svc.listActivity({
        mailboxAccountId: mailboxA.mailboxAccountId,
        window: '30d',
        source: null,
        cursor: null,
        limit: 25,
        nowMs: NOW_MS,
      });
      const execution = result.rows.find((row) => row.id === recoveryId);
      expect(execution?.executionState).toEqual({
        kind: 'failed',
        actionId: recoveryId,
        rootActionId,
        requestedCount: 6,
        errorCode: 'TransientError',
        resolution: 'review',
      });
      expect(result.stats.needsAttention).toBe(2);
      expect(result.allTimeStats.needsAttention).toBe(2);
    });

    it('preserves tenant, source, verb, sender, window, and cursor semantics', async () => {
      const senderKey = 'execution-filtered';
      const senderId = await seedSender(
        db,
        mailboxA.mailboxAccountId,
        senderKey,
        'filters@example.com',
        'Filter Target',
      );
      const foreignSenderId = await seedSender(
        db,
        mailboxB.mailboxAccountId,
        senderKey,
        'filters@example.com',
        'Filter Target',
      );
      const actionId = await seedExecutionAttempt(db, {
        mailboxAccountId: mailboxA.mailboxAccountId,
        senderId,
        senderKey,
        status: 'failed',
        errorCode: 'InvalidGrantError',
        createdAt: new Date(NOW_MS - 2 * 60 * 60 * 1000),
      });
      await seedExecutionAttempt(db, {
        mailboxAccountId: mailboxB.mailboxAccountId,
        senderId: foreignSenderId,
        senderKey,
        status: 'failed',
        errorCode: 'TransientError',
        createdAt: new Date(NOW_MS - 60 * 60 * 1000),
      });
      const activityId = await seedActivity(db, {
        mailboxAccountId: mailboxA.mailboxAccountId,
        occurredAt: new Date(NOW_MS - 4 * 60 * 60 * 1000),
        source: 'manual',
        action: 'keep',
        senderKey,
      });

      const matching = await svc.listActivity({
        mailboxAccountId: mailboxA.mailboxAccountId,
        window: '30d',
        source: 'manual',
        verbs: ['archive'],
        senderQuery: 'FILTER TARGET',
        cursor: null,
        limit: 1,
        nowMs: NOW_MS,
      });
      expect(matching.rows.map((row) => row.id)).toEqual([actionId]);
      expect(matching.rows[0]!.executionState).toMatchObject({
        kind: 'failed',
        resolution: 'review',
      });

      const wrongSource = await svc.listActivity({
        mailboxAccountId: mailboxA.mailboxAccountId,
        window: '30d',
        source: 'autopilot',
        cursor: null,
        limit: 25,
        nowMs: NOW_MS,
      });
      expect(wrongSource.rows).toHaveLength(0);

      const afterAction = await svc.listActivity({
        mailboxAccountId: mailboxA.mailboxAccountId,
        window: '30d',
        source: null,
        cursor: { occurredAt: new Date(NOW_MS - 2 * 60 * 60 * 1000), id: actionId },
        limit: 25,
        nowMs: NOW_MS,
      });
      expect(afterAction.rows.map((row) => row.id)).toEqual([activityId]);

      const outsideWindow = await svc.listActivity({
        mailboxAccountId: mailboxA.mailboxAccountId,
        window: '30d',
        source: null,
        dateFrom: new Date(NOW_MS - 60 * 60 * 1000),
        dateTo: null,
        cursor: null,
        limit: 25,
        nowMs: NOW_MS,
      });
      expect(outsideWindow.rows).toHaveLength(0);
    });
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

  it('iterates every matching row across keyset pages without crossing mailbox scope', async () => {
    const expectedIds: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      expectedIds.push(
        await seedActivity(db, {
          mailboxAccountId: mailboxA.mailboxAccountId,
          occurredAt: new Date(NOW_MS - index * 60_000),
          source: 'manual',
          action: index % 2 === 0 ? 'archive' : 'delete',
        }),
      );
    }
    await seedActivity(db, {
      mailboxAccountId: mailboxB.mailboxAccountId,
      occurredAt: new Date(NOW_MS + 60_000),
      source: 'manual',
      action: 'archive',
    });

    const actualIds: string[] = [];
    for await (const row of svc.iterateActivity(
      {
        mailboxAccountId: mailboxA.mailboxAccountId,
        window: '30d',
        source: null,
        verbs: ['archive'],
        senderQuery: '',
        dateFrom: null,
        dateTo: null,
        nowMs: NOW_MS,
      },
      2,
    )) {
      actualIds.push(row.id);
    }

    expect(actualIds).toEqual(expectedIds.filter((_, index) => index % 2 === 0));
  });

  it('paginates unresolved action lineages in bounded batches', async () => {
    const senderKey = 'many-failures';
    const senderId = await seedSender(
      db,
      mailboxA.mailboxAccountId,
      senderKey,
      'failures@example.com',
      'Many Failures',
    );
    const expectedIds: string[] = [];
    for (let index = 0; index < 7; index += 1) {
      expectedIds.push(
        await seedExecutionAttempt(db, {
          mailboxAccountId: mailboxA.mailboxAccountId,
          senderId,
          senderKey,
          status: 'failed',
          createdAt: new Date(NOW_MS - index * 60_000),
        }),
      );
    }

    const actualIds: string[] = [];
    for await (const row of svc.iterateActivity(
      {
        mailboxAccountId: mailboxA.mailboxAccountId,
        window: '30d',
        source: 'manual',
        nowMs: NOW_MS,
      },
      2,
    )) {
      actualIds.push(row.id);
    }

    expect(actualIds).toEqual(expectedIds);
  });

  it('exports late failures by terminal outcome time, not original enqueue time', async () => {
    const senderKey = 'late-failure';
    const senderId = await seedSender(
      db,
      mailboxA.mailboxAccountId,
      senderKey,
      'late-failure@example.com',
      'Late Failure',
    );
    const recentActivityId = await seedActivity(db, {
      mailboxAccountId: mailboxA.mailboxAccountId,
      occurredAt: new Date(NOW_MS - 10 * 60_000),
      source: 'manual',
      action: 'archive',
    });
    const failureId = await seedExecutionAttempt(db, {
      mailboxAccountId: mailboxA.mailboxAccountId,
      senderId,
      senderKey,
      status: 'failed',
      createdAt: new Date(NOW_MS - 40 * ONE_DAY_MS),
    });
    await db
      .update(actionJobs)
      .set({ updatedAt: new Date(NOW_MS - 30 * 60_000) })
      .where(eq(actionJobs.id, failureId));
    const olderActivityId = await seedActivity(db, {
      mailboxAccountId: mailboxA.mailboxAccountId,
      occurredAt: new Date(NOW_MS - 60 * 60_000),
      source: 'manual',
      action: 'delete',
    });

    const ids: string[] = [];
    for await (const row of svc.iterateActivity(
      {
        mailboxAccountId: mailboxA.mailboxAccountId,
        window: '30d',
        source: null,
        nowMs: NOW_MS,
      },
      1,
    )) {
      ids.push(row.id);
    }
    expect(ids).toEqual([recentActivityId, failureId, olderActivityId]);
  });

  it('freezes newly inserted rows and the bounded merge lookahead', async () => {
    const senderKey = 'snapshot-sender';
    const senderId = await seedSender(
      db,
      mailboxA.mailboxAccountId,
      senderKey,
      'snapshot@example.com',
      'Snapshot Sender',
    );
    const newestId = await seedActivity(db, {
      mailboxAccountId: mailboxA.mailboxAccountId,
      occurredAt: new Date(NOW_MS),
      source: 'manual',
      action: 'archive',
    });
    const actionId = await seedExecutionAttempt(db, {
      mailboxAccountId: mailboxA.mailboxAccountId,
      senderId,
      senderKey,
      status: 'queued',
      createdAt: new Date(NOW_MS - 60_000),
    });
    const oldestId = await seedActivity(db, {
      mailboxAccountId: mailboxA.mailboxAccountId,
      occurredAt: new Date(NOW_MS - 120_000),
      source: 'manual',
      action: 'delete',
    });

    const iterator = svc.iterateActivity(
      {
        mailboxAccountId: mailboxA.mailboxAccountId,
        window: '30d',
        source: null,
        nowMs: NOW_MS,
      },
      1,
    );
    expect((await iterator.next()).value?.id).toBe(newestId);

    await db.update(actionJobs).set({ status: 'done' }).where(eq(actionJobs.id, actionId));
    const lateId = await seedActivity(db, {
      mailboxAccountId: mailboxA.mailboxAccountId,
      occurredAt: new Date(NOW_MS - 90_000),
      source: 'manual',
      action: 'archive',
    });
    await db
      .update(activityLog)
      .set({ createdAt: new Date(Date.now() + ONE_DAY_MS) })
      .where(eq(activityLog.id, lateId));

    const remainingIds: string[] = [];
    for await (const row of iterator) remainingIds.push(row.id);
    expect(remainingIds).toEqual([actionId, oldestId]);
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

  describe('weekly review outcomes (D246)', () => {
    it('counts only terminal factual outcomes and substantiates skip/protection links', async () => {
      const senderKey = 'weekly-sender';
      await seedSender(
        db,
        mailboxA.mailboxAccountId,
        senderKey,
        'weekly@example.com',
        'Weekly Sender',
      );
      await seedActivity(db, {
        mailboxAccountId: mailboxA.mailboxAccountId,
        occurredAt: new Date(NOW_MS - ONE_DAY_MS),
        source: 'manual',
        action: 'archive',
        senderKey,
      });
      await seedActivity(db, {
        mailboxAccountId: mailboxA.mailboxAccountId,
        occurredAt: new Date(NOW_MS - ONE_DAY_MS),
        source: 'manual',
        action: 'unsubscribe',
        senderKey,
      });
      await seedActivity(db, {
        mailboxAccountId: mailboxA.mailboxAccountId,
        occurredAt: new Date(NOW_MS - ONE_DAY_MS),
        source: 'manual',
        action: 'unsubscribe_failed',
        senderKey,
      });
      const ruleId = await seedRule(db, mailboxA.mailboxAccountId, 'Weekly rule');
      const [skipped, protectedMatch] = await db
        .insert(ruleMatchLog)
        .values([
          {
            ruleId,
            mailboxAccountId: mailboxA.mailboxAccountId,
            senderKey,
            modeAtMatch: 'observe' as const,
            confidence: '0.90',
            reason: 'user skipped',
            resolution: 'dismissed' as const,
            resolvedAt: new Date(NOW_MS - ONE_DAY_MS),
            dismissReason: 'user' as const,
          },
          {
            ruleId,
            mailboxAccountId: mailboxA.mailboxAccountId,
            senderKey: 'protected-weekly',
            modeAtMatch: 'active' as const,
            confidence: '0.90',
            reason: 'became protected',
            resolution: 'dismissed' as const,
            resolvedAt: new Date(NOW_MS - ONE_DAY_MS),
            dismissReason: 'protected' as const,
          },
        ])
        .returning({ id: ruleMatchLog.id });

      expect(await svc.getWeeklyReview(mailboxA.mailboxAccountId, NOW_MS)).toMatchObject({
        window: '7d',
        completed: 1,
        skipped: 1,
        failed: 1,
        recovered: 0,
        protected: 1,
      });

      const unfiltered = await svc.listActivity({
        mailboxAccountId: mailboxA.mailboxAccountId,
        window: '7d',
        source: null,
        cursor: null,
        limit: 25,
        nowMs: NOW_MS,
      });
      expect(unfiltered.rows.map((row) => row.id)).not.toContain(skipped!.id);
      expect(unfiltered.rows.map((row) => row.id)).not.toContain(protectedMatch!.id);

      const skippedEvidence = await svc.listActivity({
        mailboxAccountId: mailboxA.mailboxAccountId,
        window: '7d',
        source: null,
        outcomes: ['skipped'],
        cursor: null,
        limit: 25,
        nowMs: NOW_MS,
      });
      expect(skippedEvidence.rows).toHaveLength(1);
      expect(skippedEvidence.rows[0]).toMatchObject({
        id: skipped!.id,
        source: 'autopilot',
        reviewOutcome: 'skipped',
        affectedCount: 0,
      });
    });

    it('classifies a zero-message recovery by action provenance without an undo token', async () => {
      const senderKey = 'weekly-recovery';
      const senderId = await seedSender(
        db,
        mailboxA.mailboxAccountId,
        senderKey,
        'recovery@example.com',
        'Recovery Sender',
      );
      const rootId = await seedExecutionAttempt(db, {
        mailboxAccountId: mailboxA.mailboxAccountId,
        senderId,
        senderKey,
        status: 'failed',
        createdAt: new Date(NOW_MS - 2 * ONE_DAY_MS),
      });
      const recoveryId = await seedExecutionAttempt(db, {
        mailboxAccountId: mailboxA.mailboxAccountId,
        senderId,
        senderKey,
        status: 'done',
        createdAt: new Date(NOW_MS - ONE_DAY_MS),
        rootActionId: rootId,
        retryOfActionId: rootId,
        recoveryAttempt: 1,
      });
      await seedActivity(db, {
        mailboxAccountId: mailboxA.mailboxAccountId,
        occurredAt: new Date(NOW_MS - ONE_DAY_MS),
        source: 'manual',
        action: 'archive',
        senderKey,
        affectedCount: 0,
        actionJobId: recoveryId,
      });

      expect(await svc.getWeeklyReview(mailboxA.mailboxAccountId, NOW_MS)).toMatchObject({
        completed: 0,
        failed: 0,
        recovered: 1,
      });
      const evidence = await svc.listActivity({
        mailboxAccountId: mailboxA.mailboxAccountId,
        window: '7d',
        source: null,
        outcomes: ['recovered'],
        cursor: null,
        limit: 25,
        nowMs: NOW_MS,
      });
      expect(evidence.rows).toHaveLength(1);
      expect(evidence.rows[0]!.reviewOutcome).toBe('recovered');
    });

    it('never binds a raw JS Date next to a raw sql expression (postgres.js parity)', async () => {
      // Regression: the skipped/protected evidence list and the export
      // iteration both compare raw sql expressions (`resolvedAt` wrapper,
      // the failed-terminal-time CASE) against Date bounds. postgres.js
      // rejects a Date bound outside a column encoder, which 500'd the
      // weekly-review evidence links and truncated every support bundle.
      const senderKey = 'driver-parity-sender';
      const senderId = await seedSender(
        db,
        mailboxA.mailboxAccountId,
        senderKey,
        'parity@example.com',
        'Parity Sender',
      );
      const ruleId = await seedRule(db, mailboxA.mailboxAccountId, 'Parity rule');
      await db.insert(ruleMatchLog).values({
        ruleId,
        mailboxAccountId: mailboxA.mailboxAccountId,
        senderKey,
        modeAtMatch: 'observe' as const,
        confidence: '0.90',
        reason: 'user skipped',
        resolution: 'dismissed' as const,
        resolvedAt: new Date(NOW_MS - ONE_DAY_MS),
        dismissReason: 'user' as const,
      });
      await seedExecutionAttempt(db, {
        mailboxAccountId: mailboxA.mailboxAccountId,
        senderId,
        senderKey,
        status: 'failed',
        createdAt: new Date(NOW_MS - ONE_DAY_MS),
      });

      driverParamLog.length = 0;
      const evidence = await svc.listActivity({
        mailboxAccountId: mailboxA.mailboxAccountId,
        window: '7d',
        source: null,
        outcomes: ['skipped', 'protected'],
        dateFrom: new Date(NOW_MS - 7 * ONE_DAY_MS),
        dateTo: new Date(NOW_MS),
        cursor: { occurredAt: new Date(NOW_MS), id: 'ffffffff-ffff-ffff-ffff-ffffffffffff' },
        limit: 25,
        nowMs: NOW_MS,
      });
      expect(evidence.rows.map((row) => row.reviewOutcome)).toContain('skipped');

      const exported: string[] = [];
      for await (const row of svc.iterateActivity({
        mailboxAccountId: mailboxA.mailboxAccountId,
        window: '7d',
        source: null,
        nowMs: NOW_MS,
      })) {
        exported.push(row.id);
      }
      expect(exported.length).toBeGreaterThan(0);

      const rawDateParams = driverParamLog.flat().filter((param) => param instanceof Date);
      expect(rawDateParams).toEqual([]);
    });
  });

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
