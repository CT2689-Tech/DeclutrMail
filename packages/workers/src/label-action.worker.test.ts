import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import {
  actionJobs,
  activityLog,
  mailMessages,
  mailboxAccounts,
  outboxEvents,
  schema,
  senders,
  undoJournal,
  users,
  workspaces,
} from '@declutrmail/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

import type { ActionVerb } from '@declutrmail/shared/actions';

import type {
  GmailMutationAccess,
  GmailMutationClient,
  LabelChange,
} from './gmail-mutation-client.js';
import {
  LabelActionWorker,
  labelChangeForVerb,
  PASSTHROUGH_MAILBOX_LOCK,
} from './label-action.worker.js';
import { OutboxPublisher } from './outbox-publisher.js';
import { InvalidGrantError, PermanentError, ValidationError } from './worker-errors.js';
import type { WorkerContext } from './worker-context.js';

/**
 * LabelActionWorker integration tests (D226).
 *
 * Real worker against in-process PGlite with every migration applied —
 * exercises the durable-set + idempotent-mutation + undo/activity/event
 * terminal-tx invariants from the Codex review, plus the score.worker
 * regression (the manual-archive `activity_log` row it reads).
 */

const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'db', 'migrations');

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

const SENDER_KEY = 'a'.repeat(64);

async function seedMailbox(db: Db): Promise<string> {
  const [ws] = await db.insert(workspaces).values({ name: 'WS' }).returning({ id: workspaces.id });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: ws!.id, email: 'owner@declutrmail.ai' })
    .returning({ id: users.id });
  const [mailbox] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId: ws!.id,
      userId: user!.id,
      provider: 'gmail',
      providerAccountId: 'owner@declutrmail.ai',
    })
    .returning({ id: mailboxAccounts.id });
  return mailbox!.id;
}

async function seedSender(db: Db, mailboxAccountId: string): Promise<string> {
  const [s] = await db
    .insert(senders)
    .values({
      mailboxAccountId,
      senderKey: SENDER_KEY,
      email: 'news@shop.example',
      domain: 'shop.example',
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
  providerMessageId: string,
  labelIds: string[],
): Promise<void> {
  await db.insert(mailMessages).values({
    mailboxAccountId,
    providerMessageId,
    providerThreadId: `t-${providerMessageId}`,
    senderKey: SENDER_KEY,
    internalDate: new Date('2026-05-01'),
    isUnread: false,
    labelIds,
  });
}

/** Fake mutation client that records every batchModify call. */
class FakeMutationClient implements GmailMutationClient {
  calls: { ids: string[]; change: LabelChange }[] = [];
  shouldThrow: Error | null = null;
  /** User labels known to the fake "Gmail" (name → id). */
  labelIdsByName = new Map<string, string>();
  ensureLabelIdCalls: string[] = [];
  async modifyLabels(): Promise<void> {}
  async batchModify(messageIds: string[], change: LabelChange): Promise<void> {
    if (this.shouldThrow) throw this.shouldThrow;
    this.calls.push({ ids: [...messageIds], change });
  }
  async ensureLabelId(name: string): Promise<string> {
    this.ensureLabelIdCalls.push(name);
    const existing = this.labelIdsByName.get(name);
    if (existing) {
      return existing;
    }
    const id = `Label_${this.labelIdsByName.size + 1}`;
    this.labelIdsByName.set(name, id);
    return id;
  }
}

function fakeAccess(client: GmailMutationClient): GmailMutationAccess {
  return { getClient: async () => client };
}

const CTX: WorkerContext = {
  jobId: 'job-1',
  workerName: 'LabelActionWorker',
  attempt: 1,
  maxAttempts: 5,
  startedAt: new Date(),
  policy: 'perMailboxPolicy',
};

describe('LabelActionWorker', () => {
  let db: Db;
  let mailboxId: string;
  let gmail: FakeMutationClient;
  let worker: LabelActionWorker;

  beforeEach(async () => {
    db = await freshDb();
    mailboxId = await seedMailbox(db);
    await seedSender(db, mailboxId);
    gmail = new FakeMutationClient();
    worker = new LabelActionWorker({
      db: db as never,
      gmailMutation: fakeAccess(gmail),
      outbox: new OutboxPublisher(),
      lock: PASSTHROUGH_MAILBOX_LOCK,
    });
  });

  describe('forward archive — sender selector', () => {
    beforeEach(async () => {
      await seedMessage(db, mailboxId, 'm1', ['INBOX', 'CATEGORY_PROMOTIONS']);
      await seedMessage(db, mailboxId, 'm2', ['INBOX']);
      await seedMessage(db, mailboxId, 'm3', ['CATEGORY_PROMOTIONS']); // not in inbox
    });

    it('resolves inbox-only, mutates, and writes the full terminal tx', async () => {
      const [job] = await db
        .insert(actionJobs)
        .values({
          mailboxAccountId: mailboxId,
          verb: 'archive',
          direction: 'forward',
          selector: { type: 'sender', senderId: 'sid', senderKey: SENDER_KEY },
          idempotencyKey: 'idem-1',
        })
        .returning();

      const result = await worker.processJob(
        { actionId: job!.id, mailboxAccountId: mailboxId, idempotencyKey: 'idem-1' },
        CTX,
      );

      // Only the two INBOX messages, INBOX removed.
      expect(gmail.calls).toHaveLength(1);
      expect(gmail.calls[0]!.ids.sort()).toEqual(['m1', 'm2']);
      expect(gmail.calls[0]!.change).toEqual({ removeLabelIds: ['INBOX'] });
      expect(result.affectedCount).toBe(2);
      expect(result.undoToken).not.toBeNull();

      const [row] = await db.select().from(actionJobs).where(eq(actionJobs.id, job!.id));
      expect(row!.status).toBe('done');
      expect(row!.affectedCount).toBe(2);
      expect(row!.undoToken).toBe(result.undoToken);
      expect(row!.resolvedMessageIds.sort()).toEqual(['m1', 'm2']);

      // Undo journal issued with ids-only payload.
      const [undo] = await db
        .select()
        .from(undoJournal)
        .where(eq(undoJournal.token, result.undoToken!));
      expect(undo!.actionKind).toBe('archive');
      expect((undo!.payload as { messageIds: string[] }).messageIds.sort()).toEqual(['m1', 'm2']);

      // Activity row (the one score.worker reads).
      const [act] = await db
        .select()
        .from(activityLog)
        .where(eq(activityLog.mailboxAccountId, mailboxId));
      expect(act!.source).toBe('manual');
      expect(act!.action).toBe('archive');
      expect(act!.affectedCount).toBe(2);
      expect(act!.senderKey).toBe(SENDER_KEY);
      expect(act!.undoToken).toBe(result.undoToken);

      // Outbox event published.
      const [evt] = await db.select().from(outboxEvents);
      expect(evt!.topic).toBe('actions.label_action_applied');

      // Local label mirror updated — INBOX gone from m1/m2, m3 untouched.
      const msgs = await db
        .select()
        .from(mailMessages)
        .where(eq(mailMessages.mailboxAccountId, mailboxId));
      const byId = Object.fromEntries(msgs.map((m) => [m.providerMessageId, m.labelIds]));
      expect(byId['m1']).not.toContain('INBOX');
      expect(byId['m2']).not.toContain('INBOX');
      expect(byId['m3']).toContain('CATEGORY_PROMOTIONS');
    });

    it('is idempotent on a done row (no second mutation)', async () => {
      const [job] = await db
        .insert(actionJobs)
        .values({
          mailboxAccountId: mailboxId,
          verb: 'archive',
          direction: 'forward',
          status: 'done',
          affectedCount: 2,
          selector: { type: 'sender', senderId: 'sid', senderKey: SENDER_KEY },
          idempotencyKey: 'idem-done',
        })
        .returning();

      const result = await worker.processJob(
        { actionId: job!.id, mailboxAccountId: mailboxId, idempotencyKey: 'idem-done' },
        CTX,
      );
      expect(result.alreadyDone).toBe(true);
      expect(gmail.calls).toHaveLength(0);
    });
  });

  it('forward archive — empty resolve writes 0-affected activity_log row but issues no undo token', async () => {
    // Sender has no INBOX messages.
    await seedMessage(db, mailboxId, 'm9', ['CATEGORY_PROMOTIONS']);
    const [job] = await db
      .insert(actionJobs)
      .values({
        mailboxAccountId: mailboxId,
        verb: 'archive',
        direction: 'forward',
        selector: { type: 'sender', senderId: 'sid', senderKey: SENDER_KEY },
        idempotencyKey: 'idem-empty',
      })
      .returning();

    const result = await worker.processJob(
      { actionId: job!.id, mailboxAccountId: mailboxId, idempotencyKey: 'idem-empty' },
      CTX,
    );
    expect(result.affectedCount).toBe(0);
    expect(result.undoToken).toBeNull();
    expect(gmail.calls).toHaveLength(0);
    const undos = await db.select().from(undoJournal);
    expect(undos).toHaveLength(0);
    // 2026-06-05 — audit-trail consistency: the user MADE a decision
    // (Archive on this sender). Even when nothing matched, the
    // activity_log row exists so /activity surfaces the intent —
    // matches the Keep precedent (0-message decisions logged).
    const acts = await db
      .select()
      .from(activityLog)
      .where(eq(activityLog.mailboxAccountId, mailboxId));
    expect(acts).toHaveLength(1);
    expect(acts[0]!.action).toBe('archive');
    expect(acts[0]!.affectedCount).toBe(0);
    expect(acts[0]!.senderKey).toBe(SENDER_KEY);
    expect(acts[0]!.undoToken).toBeNull();
  });

  it('forward archive — messages selector uses the frozen set', async () => {
    await seedMessage(db, mailboxId, 'm1', ['INBOX']);
    await seedMessage(db, mailboxId, 'm2', ['INBOX']);
    const [job] = await db
      .insert(actionJobs)
      .values({
        mailboxAccountId: mailboxId,
        verb: 'archive',
        direction: 'forward',
        selector: { type: 'messages' },
        resolvedMessageIds: ['m1', 'm2'],
        requestedCount: 2,
        idempotencyKey: 'idem-msgs',
      })
      .returning();

    const result = await worker.processJob(
      { actionId: job!.id, mailboxAccountId: mailboxId, idempotencyKey: 'idem-msgs' },
      CTX,
    );
    expect(gmail.calls[0]!.ids.sort()).toEqual(['m1', 'm2']);
    const [act] = await db.select().from(activityLog);
    expect(act!.senderKey).toBeNull(); // messages selector → account-scoped
    expect(result.affectedCount).toBe(2);
  });

  it('reverse (undo) re-adds INBOX and flips reverted_at', async () => {
    await seedMessage(db, mailboxId, 'm1', ['CATEGORY_PROMOTIONS']); // archived (no INBOX)
    const [undo] = await db
      .insert(undoJournal)
      .values({
        mailboxAccountId: mailboxId,
        actionKind: 'archive',
        payload: { kind: 'archive', messageIds: ['m1'], priorLabels: ['INBOX'] },
      })
      .returning();
    const [job] = await db
      .insert(actionJobs)
      .values({
        mailboxAccountId: mailboxId,
        verb: 'archive',
        direction: 'reverse',
        selector: { type: 'messages' },
        resolvedMessageIds: ['m1'],
        undoToken: undo!.token,
        idempotencyKey: `revert:${undo!.token}`,
      })
      .returning();

    await worker.processJob(
      { actionId: job!.id, mailboxAccountId: mailboxId, idempotencyKey: `revert:${undo!.token}` },
      CTX,
    );

    expect(gmail.calls[0]!.change).toEqual({ addLabelIds: ['INBOX'] });
    const [m] = await db
      .select()
      .from(mailMessages)
      .where(eq(mailMessages.providerMessageId, 'm1'));
    expect(m!.labelIds).toContain('INBOX');
    const [u] = await db.select().from(undoJournal).where(eq(undoJournal.token, undo!.token));
    expect(u!.revertedAt).not.toBeNull();
    const [j] = await db.select().from(actionJobs).where(eq(actionJobs.id, job!.id));
    expect(j!.status).toBe('done');
  });

  describe('later — label name→id resolution (live-smoke fix 2026-06-09)', () => {
    // The registry's buildLabelChange emits the symbolic NAME
    // `DeclutrMail/Later`; Gmail's batchModify accepts only IDS (live
    // result: `Gmail returned 400: Invalid label: DeclutrMail/Later`).
    // The worker resolves the name via ensureLabelId at the mutation
    // seam, and the RESOLVED id feeds the local mirror so it matches
    // what sync stores.
    it('forward resolves DeclutrMail/Later to an id — batchModify + mirror carry only ids', async () => {
      await seedMessage(db, mailboxId, 'l1', ['INBOX', 'CATEGORY_PROMOTIONS']);
      const [job] = await db
        .insert(actionJobs)
        .values({
          mailboxAccountId: mailboxId,
          verb: 'later',
          direction: 'forward',
          selector: { type: 'sender', senderId: 'sid', senderKey: SENDER_KEY },
          idempotencyKey: 'idem-later-1',
        })
        .returning();

      const result = await worker.processJob(
        { actionId: job!.id, mailboxAccountId: mailboxId, idempotencyKey: 'idem-later-1' },
        CTX,
      );

      // Only the user label resolves; INBOX is a system id and must NOT
      // pass through ensureLabelId.
      expect(gmail.ensureLabelIdCalls).toEqual(['DeclutrMail/Later']);
      expect(gmail.calls).toHaveLength(1);
      expect(gmail.calls[0]!.change).toEqual({
        removeLabelIds: ['INBOX'],
        addLabelIds: ['Label_1'],
      });
      expect(result.affectedCount).toBe(1);

      // The local mirror stores the RESOLVED id — the same raw Gmail
      // label id sync stores — never the name.
      const [m] = await db
        .select()
        .from(mailMessages)
        .where(eq(mailMessages.providerMessageId, 'l1'));
      expect(m!.labelIds).toContain('Label_1');
      expect(m!.labelIds).not.toContain('DeclutrMail/Later');
      expect(m!.labelIds).not.toContain('INBOX');
      expect(m!.labelIds).toContain('CATEGORY_PROMOTIONS');
    });

    it('reverse (undo later) removes the resolved id from Gmail and the mirror', async () => {
      // Forward already ran: the label exists in "Gmail" and the message
      // mirror carries the resolved id (as sync would have stored it).
      gmail.labelIdsByName.set('DeclutrMail/Later', 'Label_77');
      await seedMessage(db, mailboxId, 'l1', ['Label_77', 'CATEGORY_PROMOTIONS']);
      const [undo] = await db
        .insert(undoJournal)
        .values({
          mailboxAccountId: mailboxId,
          actionKind: 'later',
          payload: { kind: 'later', messageIds: ['l1'], priorLabels: ['INBOX'] },
        })
        .returning();
      const [job] = await db
        .insert(actionJobs)
        .values({
          mailboxAccountId: mailboxId,
          verb: 'later',
          direction: 'reverse',
          selector: { type: 'messages' },
          resolvedMessageIds: ['l1'],
          undoToken: undo!.token,
          idempotencyKey: `revert:${undo!.token}`,
        })
        .returning();

      await worker.processJob(
        { actionId: job!.id, mailboxAccountId: mailboxId, idempotencyKey: `revert:${undo!.token}` },
        CTX,
      );

      // The reverse resolves to the EXISTING id — the same one the
      // forward path added — so the revert removes the right label.
      expect(gmail.ensureLabelIdCalls).toEqual(['DeclutrMail/Later']);
      expect(gmail.calls[0]!.change).toEqual({
        addLabelIds: ['INBOX'],
        removeLabelIds: ['Label_77'],
      });
      const [m] = await db
        .select()
        .from(mailMessages)
        .where(eq(mailMessages.providerMessageId, 'l1'));
      expect(m!.labelIds).toContain('INBOX');
      expect(m!.labelIds).not.toContain('Label_77');
      const [u] = await db.select().from(undoJournal).where(eq(undoJournal.token, undo!.token));
      expect(u!.revertedAt).not.toBeNull();
    });

    it('fails permanently on attempt 1 for a Gmail 400 (no retry storm)', async () => {
      await seedMessage(db, mailboxId, 'l1', ['INBOX']);
      gmail.shouldThrow = new PermanentError(
        'Gmail returned 400: Invalid label: DeclutrMail/Later',
      );
      const [job] = await db
        .insert(actionJobs)
        .values({
          mailboxAccountId: mailboxId,
          verb: 'later',
          direction: 'forward',
          selector: { type: 'messages' },
          resolvedMessageIds: ['l1'],
          idempotencyKey: 'idem-400',
        })
        .returning();

      // attemptsMade=0 → attempt 1 of 5. A deterministic 4xx is terminal
      // HERE: isNonRetryable(PermanentError) short-circuits the attempt
      // cap and onTerminalFailure records status=failed immediately.
      await expect(
        worker.run({
          id: 'job-400',
          data: { actionId: job!.id, mailboxAccountId: mailboxId, idempotencyKey: 'idem-400' },
          attemptsMade: 0,
        } as never),
      ).rejects.toThrow('Invalid label');

      const [row] = await db.select().from(actionJobs).where(eq(actionJobs.id, job!.id));
      expect(row!.status).toBe('failed');
      expect(row!.errorCode).toBe('PermanentError');
    });
  });

  it('forward delete — applies TRASH + drops INBOX from local mirror', async () => {
    // Spec v1.2 Decision 1 — delete = batchModify add TRASH + remove INBOX.
    // Two messages currently in INBOX, plus one not in inbox (skipped).
    await seedMessage(db, mailboxId, 'd1', ['INBOX', 'CATEGORY_PROMOTIONS']);
    await seedMessage(db, mailboxId, 'd2', ['INBOX']);
    await seedMessage(db, mailboxId, 'd3', ['CATEGORY_PROMOTIONS']);

    const [job] = await db
      .insert(actionJobs)
      .values({
        mailboxAccountId: mailboxId,
        verb: 'delete',
        direction: 'forward',
        selector: { type: 'sender', senderId: 'sid', senderKey: SENDER_KEY },
        idempotencyKey: 'idem-del-1',
      })
      .returning();

    const result = await worker.processJob(
      { actionId: job!.id, mailboxAccountId: mailboxId, idempotencyKey: 'idem-del-1' },
      CTX,
    );

    // Only the two INBOX messages, with the composite TRASH-add + INBOX-remove change.
    expect(gmail.calls).toHaveLength(1);
    expect(gmail.calls[0]!.ids.sort()).toEqual(['d1', 'd2']);
    expect(gmail.calls[0]!.change).toEqual({
      addLabelIds: ['TRASH'],
      removeLabelIds: ['INBOX'],
    });
    expect(result.affectedCount).toBe(2);
    expect(result.undoToken).not.toBeNull();

    // Activity log + undo journal kind both record `delete`.
    const [act] = await db
      .select()
      .from(activityLog)
      .where(eq(activityLog.mailboxAccountId, mailboxId));
    expect(act!.action).toBe('delete');
    const [undo] = await db
      .select()
      .from(undoJournal)
      .where(eq(undoJournal.token, result.undoToken!));
    expect(undo!.actionKind).toBe('delete');
    // Delete undo payload omits priorLabels — reverse `LabelChange` is the
    // restoration step (no `priorLabels` lookup needed by the worker).
    const payload = undo!.payload as { kind: string; messageIds: string[] };
    expect(payload).toEqual({ kind: 'delete', messageIds: expect.arrayContaining(['d1', 'd2']) });
    // Delete undo window = 30 days regardless of tier (Gmail Trash physical
    // window; tier-shorter would falsely show "expired" while the mail is
    // still trivially recoverable in Gmail).
    expect(undo!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 25 * 24 * 60 * 60 * 1000);

    // Local label mirror: INBOX gone from d1/d2; TRASH added; d3 untouched.
    const msgs = await db
      .select()
      .from(mailMessages)
      .where(eq(mailMessages.mailboxAccountId, mailboxId));
    const byId = Object.fromEntries(msgs.map((m) => [m.providerMessageId, m.labelIds]));
    expect(byId['d1']).toContain('TRASH');
    expect(byId['d1']).not.toContain('INBOX');
    expect(byId['d1']).toContain('CATEGORY_PROMOTIONS'); // unrelated labels preserved
    expect(byId['d2']).toContain('TRASH');
    expect(byId['d2']).not.toContain('INBOX');
    expect(byId['d3']).toEqual(['CATEGORY_PROMOTIONS']);
  });

  it('forward delete — olderThanDays narrows the sender resolution', async () => {
    // The worker reads `older_than_days` and applies it to the sender
    // resolver via `internal_date <= now() - interval 'N days'`.
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    await seedMessage(db, mailboxId, 'd-recent', ['INBOX']);
    // Manually backdate one message so the resolver picks ONLY it.
    await db
      .update(mailMessages)
      .set({ internalDate: new Date(now - 200 * oneDay) })
      .where(eq(mailMessages.providerMessageId, 'd-recent'));
    const [oldMsg] = await db
      .insert(mailMessages)
      .values({
        mailboxAccountId: mailboxId,
        providerMessageId: 'd-old',
        providerThreadId: 't-old',
        senderKey: SENDER_KEY,
        internalDate: new Date(now - 400 * oneDay),
        isUnread: false,
        labelIds: ['INBOX'],
      })
      .returning();
    expect(oldMsg).toBeTruthy();

    const [job] = await db
      .insert(actionJobs)
      .values({
        mailboxAccountId: mailboxId,
        verb: 'delete',
        direction: 'forward',
        selector: { type: 'sender', senderId: 'sid', senderKey: SENDER_KEY },
        olderThanDays: 365,
        idempotencyKey: 'idem-del-365',
      })
      .returning();

    const result = await worker.processJob(
      { actionId: job!.id, mailboxAccountId: mailboxId, idempotencyKey: 'idem-del-365' },
      CTX,
    );

    // 200-day-old message is NOT picked up; 400-day-old IS.
    expect(gmail.calls).toHaveLength(1);
    expect(gmail.calls[0]!.ids).toEqual(['d-old']);
    expect(result.affectedCount).toBe(1);
  });

  it('records status=failed on a terminal (non-retryable) error', async () => {
    await seedMessage(db, mailboxId, 'm1', ['INBOX']);
    gmail.shouldThrow = new InvalidGrantError('grant gone');
    const [job] = await db
      .insert(actionJobs)
      .values({
        mailboxAccountId: mailboxId,
        verb: 'archive',
        direction: 'forward',
        selector: { type: 'messages' },
        resolvedMessageIds: ['m1'],
        idempotencyKey: 'idem-fail',
      })
      .returning();

    // run() wraps processJob → classifies InvalidGrantError as terminal →
    // fires onTerminalFailure (status=failed) → rethrows.
    await expect(
      worker.run({
        id: 'job-fail',
        data: { actionId: job!.id, mailboxAccountId: mailboxId, idempotencyKey: 'idem-fail' },
        attemptsMade: 0,
      } as never),
    ).rejects.toThrow('grant gone');

    const [row] = await db.select().from(actionJobs).where(eq(actionJobs.id, job!.id));
    expect(row!.status).toBe('failed');
    expect(row!.errorCode).toBe('InvalidGrantError');
  });
});

/**
 * `labelChangeForVerb` reads the Action Registry (ADR-0015) as the single
 * source of truth — P3 deleted the worker-local `VERB_LABEL_CHANGES` map.
 * Tested directly because the policy-only branch is unreachable through
 * the worker's DB path (the `action_verb` pg_enum is label-modify-only,
 * so a `keep` row can't be inserted).
 */
describe('labelChangeForVerb (registry-routed, ADR-0015)', () => {
  it('returns the archive forward/reverse INBOX delta from the registry', () => {
    expect(labelChangeForVerb('archive')).toEqual({
      forward: { removeLabelIds: ['INBOX'] },
      reverse: { addLabelIds: ['INBOX'] },
    });
  });

  it('returns the later forward/reverse delta from the registry', () => {
    // ADR-0019 + spec v1.2: later pipeline is now complete (local mirror
    // derived from `LabelChange`, undo payload union covers it, event
    // schema accepts the verb).
    expect(labelChangeForVerb('later')).toEqual({
      forward: { removeLabelIds: ['INBOX'], addLabelIds: ['DeclutrMail/Later'] },
      reverse: { addLabelIds: ['INBOX'], removeLabelIds: ['DeclutrMail/Later'] },
    });
  });

  it('returns the delete forward/reverse TRASH delta from the registry', () => {
    // Spec v1.2 Decision 1 — delete = batchModify add TRASH + remove
    // INBOX; reverse restores INBOX + removes TRASH. Gmail Trash 30-day
    // recovery window is the physical guarantee.
    expect(labelChangeForVerb('delete')).toEqual({
      forward: { addLabelIds: ['TRASH'], removeLabelIds: ['INBOX'] },
      reverse: { addLabelIds: ['INBOX'], removeLabelIds: ['TRASH'] },
    });
  });

  it('refuses a policy-only verb (pipeline isolation, consensus §5)', () => {
    // `keep` is policy-only — it must never reach the label worker.
    expect(() => labelChangeForVerb('keep')).toThrow(ValidationError);
  });

  it('refuses a label-modify verb whose pipeline is incomplete (F1)', () => {
    // The `action_verb` pg_enum currently lists only verbs whose
    // pipeline IS complete (archive/later/delete), so we synthetically
    // probe the guard by calling it with a verb that is in the Action
    // Registry but NOT in `PIPELINE_COMPLETE_VERBS` — `unarchive` is the
    // live candidate (label-modify in the registry, not in the pg_enum
    // or `undo_action_kind`/`activity_action`, so its pipeline is by
    // definition incomplete). This documents the guard's role for any
    // future verb added to the enum without all four surfaces wired up.
    const unarchive = 'unarchive' as ActionVerb;
    expect(() => labelChangeForVerb(unarchive)).toThrow(ValidationError);
    expect(() => labelChangeForVerb(unarchive)).toThrow(/archive-only/);
  });
});
