import { actionJobs, mailboxAccounts, schema, senders, users, workspaces } from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

import { UndoService } from './undo.service.js';
import type { UndoPayload } from './undo.types.js';
import { MIN_UNDO_WINDOW_DAYS, TIER_IDS, TIER_MANIFEST } from '@declutrmail/shared/entitlements';

/**
 * UndoService integration tests (D35, D58, D232).
 *
 * Runs the real service against an in-process PGlite database with
 * every migration applied — covers the idempotent claim/revert
 * lifecycle, the D232 deletion-time read, and the active-listing
 * query the persistent tray (D35) consumes.
 *
 * Tests intentionally cover behavior, not internals: a failure here
 * surfaces a contract regression (e.g., double-revert, missing
 * expiry filter) — exactly what would land in a customer-impacting bug.
 */

type Db = ReturnType<typeof drizzle<typeof schema>>;

async function freshDb(): Promise<Db> {
  return freshTestDb();
}

async function seedMailbox(
  db: Db,
): Promise<{ userId: string; workspaceId: string; mailboxId: string }> {
  const [ws] = await db.insert(workspaces).values({ name: 'Test WS' }).returning({
    id: workspaces.id,
  });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: ws!.id, email: 'owner@declutrmail.ai' })
    .returning({ id: users.id });
  const mailboxId = await addMailbox(db, ws!.id, user!.id, 'owner@declutrmail.ai');
  return { userId: user!.id, workspaceId: ws!.id, mailboxId };
}

/** Add another mailbox under an existing user (per-USER D232 coverage). */
async function addMailbox(
  db: Db,
  workspaceId: string,
  userId: string,
  providerAccountId: string,
): Promise<string> {
  const [mailbox] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId,
      userId,
      provider: 'gmail',
      providerAccountId,
    })
    .returning({ id: mailboxAccounts.id });
  return mailbox!.id;
}

const archivePayload: UndoPayload = {
  kind: 'archive',
  messageIds: ['msg-1', 'msg-2', 'msg-3'],
  priorLabels: ['INBOX', 'CATEGORY_UPDATES'],
};

describe('UndoService', () => {
  let db: Db;
  let userId: string;
  let workspaceId: string;
  let mailboxId: string;
  let svc: UndoService;

  beforeEach(async () => {
    db = await freshDb();
    ({ userId, workspaceId, mailboxId } = await seedMailbox(db));
    // The service expects the DRIZZLE injection — bypass DI in unit tests
    // by direct construction.
    svc = new UndoService(db as never);
  });

  describe('issue', () => {
    it('persists a token with default 7-day expiry per D232', async () => {
      const before = Date.now();
      const entry = await svc.issue({
        mailboxAccountId: mailboxId,
        actionKind: 'archive',
        payload: archivePayload,
      });
      const after = Date.now();

      expect(entry.token).toMatch(/^[0-9a-f]{8}-/i);
      expect(entry.actionKind).toBe('archive');
      expect(entry.payload).toEqual(archivePayload);
      expect(entry.revertedAt).toBeNull();
      expect(entry.executedAt).toBeNull();

      // Default expiry: `MIN_UNDO_WINDOW_DAYS` from createdAt, DERIVED —
      // the literal 7 here outlived the decision that set it. Every tier
      // moved to 30 on 2026-08-23 and this assertion stayed green,
      // because the value it checked was the column default rather than
      // anything the ladder owned. `issue()` now computes the fallback
      // from the manifest, so this fails if the two ever disagree again.
      // Generous slop for SQL `now()` vs test wall-clock.
      const expiryMs = entry.expiresAt.getTime();
      const defaultWindowMs = MIN_UNDO_WINDOW_DAYS * 24 * 60 * 60 * 1000;
      expect(expiryMs - before).toBeGreaterThan(defaultWindowMs - 5_000);
      expect(expiryMs - after).toBeLessThan(defaultWindowMs + 5_000);
    });

    it('honors an explicit expires_at from the caller', async () => {
      const customExpiry = new Date('2099-01-01T00:00:00Z');
      const entry = await svc.issue({
        mailboxAccountId: mailboxId,
        actionKind: 'later',
        payload: { kind: 'later', messageIds: ['m1'], priorLabels: ['INBOX'] },
        expiresAt: customExpiry,
      });
      expect(entry.expiresAt.getTime()).toBe(customExpiry.getTime());
    });
  });

  describe('claimForRevert + recordRevertSuccess', () => {
    it('first claim returns "claimed" and stamps executed_at', async () => {
      const entry = await svc.issue({
        mailboxAccountId: mailboxId,
        actionKind: 'archive',
        payload: archivePayload,
      });
      const result = await svc.claimForRevert(entry.token, mailboxId);
      expect(result.outcome).toBe('claimed');
      if (result.outcome === 'claimed') {
        expect(result.entry.executedAt).not.toBeNull();
        expect(result.entry.revertedAt).toBeNull();
      }
    });

    it('second claim returns "already-reverted" (idempotency lock)', async () => {
      const entry = await svc.issue({
        mailboxAccountId: mailboxId,
        actionKind: 'archive',
        payload: archivePayload,
      });
      await svc.claimForRevert(entry.token, mailboxId);
      await svc.recordRevertSuccess(entry.token);
      const second = await svc.claimForRevert(entry.token, mailboxId);
      expect(second.outcome).toBe('already-reverted');
    });

    it('expired token returns "expired" without claiming', async () => {
      const past = new Date(Date.now() - 1_000);
      const entry = await svc.issue({
        mailboxAccountId: mailboxId,
        actionKind: 'archive',
        payload: archivePayload,
        expiresAt: past,
      });
      const result = await svc.claimForRevert(entry.token, mailboxId);
      expect(result.outcome).toBe('expired');
      if (result.outcome === 'expired') {
        expect(result.entry.executedAt).toBeNull();
      }
    });

    it('unknown token returns "not-found"', async () => {
      const result = await svc.claimForRevert('00000000-0000-0000-0000-000000000000', mailboxId);
      expect(result.outcome).toBe('not-found');
    });

    it('cross-mailbox token returns "not-found" (tenant isolation)', async () => {
      const entry = await svc.issue({
        mailboxAccountId: mailboxId,
        actionKind: 'archive',
        payload: archivePayload,
      });
      // A different mailbox — same DB, separate tenant.
      const [otherWs] = await db
        .insert(workspaces)
        .values({ name: 'Other' })
        .returning({ id: workspaces.id });
      const [otherUser] = await db
        .insert(users)
        .values({ workspaceId: otherWs!.id, email: 'other@declutrmail.ai' })
        .returning({ id: users.id });
      const [otherMailbox] = await db
        .insert(mailboxAccounts)
        .values({
          workspaceId: otherWs!.id,
          userId: otherUser!.id,
          provider: 'gmail',
          providerAccountId: 'other@declutrmail.ai',
        })
        .returning({ id: mailboxAccounts.id });
      const result = await svc.claimForRevert(entry.token, otherMailbox!.id);
      expect(result.outcome).toBe('not-found');
    });
  });

  describe('listActiveDecisions — the tray speaks in decisions, not tokens', () => {
    let seq = 0;
    async function seedSender(name: string): Promise<{ id: string; senderKey: string }> {
      seq += 1;
      const senderKey = `key-${seq}`;
      const [row] = await db
        .insert(senders)
        .values({
          mailboxAccountId: mailboxId,
          senderKey,
          displayName: name,
          email: `s${seq}@example.com`,
          domain: 'example.com',
          gmailCategory: 'promotions',
          firstSeenAt: new Date('2026-01-01'),
          lastSeenAt: new Date('2026-05-01'),
        })
        .returning({ id: senders.id });
      return { id: row!.id, senderKey };
    }
    /** A finished forward job WITH its undo token, as the label worker leaves it. */
    async function seedDoneJob(input: {
      sender: { id: string; senderKey: string };
      verb: 'archive' | 'delete' | 'later';
      affected: number;
      compositeId?: string | null;
      mailbox?: string;
    }): Promise<{ id: string; token: string }> {
      seq += 1;
      const entry = await svc.issue({
        mailboxAccountId: input.mailbox ?? mailboxId,
        actionKind: input.verb,
        payload: { kind: input.verb, messageIds: ['m'], priorLabels: ['INBOX'] } as UndoPayload,
      });
      const [job] = await db
        .insert(actionJobs)
        .values({
          mailboxAccountId: input.mailbox ?? mailboxId,
          verb: input.verb,
          direction: 'forward',
          selector: {
            type: 'sender',
            senderId: input.sender.id,
            senderKey: input.sender.senderKey,
          },
          resolvedMessageIds: [],
          requestedCount: input.affected,
          affectedCount: input.affected,
          status: 'done',
          idempotencyKey: `job-${seq}`,
          undoToken: entry.token,
          compositeId: input.compositeId ?? null,
          ...(input.verb === 'later' ? { wakeAt: new Date('2099-01-01T09:00:00Z') } : {}),
        })
        .returning({ id: actionJobs.id });
      return { id: job!.id, token: entry.token };
    }

    it('collapses one bulk action over two senders into ONE decision with names and counts', async () => {
      const yankee = await seedSender('Yankee Candle');
      const retail = await seedSender('RetailMeNot');
      const anchor = await seedDoneJob({ sender: yankee, verb: 'delete', affected: 251 });
      const child = await seedDoneJob({
        sender: retail,
        verb: 'delete',
        affected: 189,
        compositeId: anchor.id,
      });

      const decisions = await svc.listActiveDecisions(mailboxId);
      expect(decisions).toHaveLength(1);
      const [d] = decisions;
      expect(d!.groupId).toBe(anchor.id);
      expect(d!.actionKind).toBe('delete');
      expect(d!.senderCount).toBe(2);
      expect(d!.affectedCount).toBe(440);
      // Any member token reverts the whole batch; it must BE a member's.
      expect([anchor.token, child.token]).toContain(d!.token);
      // Largest first — the name a reader recognises leads the line.
      expect(d!.members.map((m) => [m.senderName, m.affectedCount, m.token])).toEqual([
        ['Yankee Candle', 251, anchor.token],
        ['RetailMeNot', 189, child.token],
      ]);
    });

    it('keeps two separate single-sender actions as two decisions, newest first', async () => {
      const a = await seedSender('Alpha');
      const b = await seedSender('Beta');
      const first = await seedDoneJob({ sender: a, verb: 'archive', affected: 3 });
      await new Promise((r) => setTimeout(r, 10));
      const second = await seedDoneJob({ sender: b, verb: 'delete', affected: 7 });

      const decisions = await svc.listActiveDecisions(mailboxId);
      expect(decisions.map((d) => d.groupId)).toEqual([second.id, first.id]);
      expect(decisions.map((d) => d.senderCount)).toEqual([1, 1]);
    });

    it('drops a reverted member from the decision and from its totals', async () => {
      const a = await seedSender('Alpha');
      const b = await seedSender('Beta');
      const anchor = await seedDoneJob({ sender: a, verb: 'delete', affected: 10 });
      const child = await seedDoneJob({
        sender: b,
        verb: 'delete',
        affected: 5,
        compositeId: anchor.id,
      });
      await svc.claimForRevert(anchor.token, mailboxId);
      await svc.recordRevertSuccess(anchor.token);

      const [d] = await svc.listActiveDecisions(mailboxId);
      // Still the same decision — identity must not move when the anchor's
      // own token is the one that was undone.
      expect(d!.groupId).toBe(anchor.id);
      expect(d!.token).toBe(child.token);
      expect(d!.senderCount).toBe(1);
      expect(d!.affectedCount).toBe(5);
    });

    it('flags a decision whose members carry different verbs (one total would mislabel them)', async () => {
      const a = await seedSender('Acme');
      const primary = await seedDoneJob({ sender: a, verb: 'later', affected: 3 });
      await seedDoneJob({ sender: a, verb: 'delete', affected: 9, compositeId: primary.id });
      const b = await seedSender('Beta');
      await seedDoneJob({ sender: b, verb: 'archive', affected: 4 });

      const decisions = await svc.listActiveDecisions(mailboxId);
      const mixed = decisions.find((d) => d.groupId === primary.id)!;
      expect(mixed.mixedKinds).toBe(true);
      expect(mixed.actionKind).toBe('later'); // the anchor's verb leads
      expect(mixed.senderCount).toBe(1);
      expect(decisions.find((d) => d.groupId !== primary.id)!.mixedKinds).toBe(false);
    });

    it('never leaks another mailbox, and lists a token with no job as its own nameless decision', async () => {
      const other = await addMailbox(db, workspaceId, userId, 'other@declutrmail.ai');
      const foreign = await seedSender('Foreign');
      await seedDoneJob({ sender: foreign, verb: 'delete', affected: 99, mailbox: other });
      // An expired token is history — Activity's job, not the tray's.
      await svc.issue({
        mailboxAccountId: mailboxId,
        actionKind: 'archive',
        payload: archivePayload,
        expiresAt: new Date(Date.now() - 60_000),
      });
      // Autopilot writes journal rows with no action_jobs row behind them.
      const bare = await svc.issue({
        mailboxAccountId: mailboxId,
        actionKind: 'archive',
        payload: archivePayload,
      });

      const decisions = await svc.listActiveDecisions(mailboxId);
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({
        groupId: bare.token,
        token: bare.token,
        senderCount: 0,
        affectedCount: null,
        members: [],
      });
    });

    it('caps the member list but keeps exact totals for a very large bulk', async () => {
      const first = await seedSender('Sender 0');
      const anchor = await seedDoneJob({ sender: first, verb: 'archive', affected: 1 });
      for (let i = 1; i < 30; i += 1) {
        const s = await seedSender(`Sender ${i}`);
        await seedDoneJob({ sender: s, verb: 'archive', affected: 1, compositeId: anchor.id });
      }
      const [d] = await svc.listActiveDecisions(mailboxId);
      expect(d!.senderCount).toBe(30);
      expect(d!.affectedCount).toBe(30);
      expect(d!.members).toHaveLength(25);
    });
  });

  describe('activeExpirySummaryForUser — D232 deletion-time read (per-USER)', () => {
    it('returns null/0 for a user with no active tokens', async () => {
      const result = await svc.activeExpirySummaryForUser(userId);
      expect(result.latest).toBeNull();
      expect(result.activeCount).toBe(0);
    });

    it('aggregates across ALL of the user mailboxes (the per-mailbox bug)', async () => {
      // Second mailbox under the SAME user — the buildout bug was a
      // per-mailbox MAX that could not see this mailbox's later expiry.
      const secondMailboxId = await addMailbox(db, workspaceId, userId, 'owner2@declutrmail.ai');
      await svc.issue({
        mailboxAccountId: mailboxId,
        actionKind: 'archive',
        payload: archivePayload,
        expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      });
      const farOnSecond = await svc.issue({
        mailboxAccountId: secondMailboxId,
        actionKind: 'archive',
        payload: archivePayload,
        expiresAt: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000),
      });

      const result = await svc.activeExpirySummaryForUser(userId);
      expect(result.latest).not.toBeNull();
      expect(result.latest!.getTime()).toBe(farOnSecond.expiresAt.getTime());
      expect(result.activeCount).toBe(2);
    });

    it('returns the most distant active expiry, ignoring expired + reverted', async () => {
      const near = await svc.issue({
        mailboxAccountId: mailboxId,
        actionKind: 'archive',
        payload: archivePayload,
        expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      });
      const far = await svc.issue({
        mailboxAccountId: mailboxId,
        actionKind: 'archive',
        payload: archivePayload,
        expiresAt: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
      });
      // An expired row that's farther than `far` must NOT dominate.
      await svc.issue({
        mailboxAccountId: mailboxId,
        actionKind: 'archive',
        payload: archivePayload,
        expiresAt: new Date(Date.now() - 1_000),
      });
      // A reverted row that's farther than `far` must NOT dominate.
      const revertedFar = await svc.issue({
        mailboxAccountId: mailboxId,
        actionKind: 'archive',
        payload: archivePayload,
        expiresAt: new Date(Date.now() + 100 * 24 * 60 * 60 * 1000),
      });
      await svc.claimForRevert(revertedFar.token, mailboxId);
      await svc.recordRevertSuccess(revertedFar.token);

      const result = await svc.activeExpirySummaryForUser(userId);
      expect(result.latest).not.toBeNull();
      expect(result.latest!.getTime()).toBe(far.expiresAt.getTime());
      expect(result.activeCount).toBe(2); // near + far; expired + reverted excluded
      // Reference `near` so a future regression on a "single-row table"
      // path is caught (sanity that `near` was actually inserted).
      expect(near.expiresAt.getTime()).toBeLessThan(result.latest!.getTime());
    });

    it("never counts another user's tokens (tenant isolation)", async () => {
      const [otherWs] = await db
        .insert(workspaces)
        .values({ name: 'Other' })
        .returning({ id: workspaces.id });
      const [otherUser] = await db
        .insert(users)
        .values({ workspaceId: otherWs!.id, email: 'other@declutrmail.ai' })
        .returning({ id: users.id });
      const otherMailboxId = await addMailbox(
        db,
        otherWs!.id,
        otherUser!.id,
        'other@declutrmail.ai',
      );
      await svc.issue({
        mailboxAccountId: otherMailboxId,
        actionKind: 'archive',
        payload: archivePayload,
        expiresAt: new Date(Date.now() + 50 * 24 * 60 * 60 * 1000),
      });

      const result = await svc.activeExpirySummaryForUser(userId);
      expect(result.latest).toBeNull();
      expect(result.activeCount).toBe(0);
    });
  });

  describe('defaultExpiresAt', () => {
    it('returns the ladder FLOOR from the provided anchor, not a fixed 7 days', () => {
      // Derived: the fallback is the smallest window any tier carries,
      // so it can only under-promise. Pinned to a literal 7 until
      // 2026-08-23, when every tier moved to 30 and the "keeps Free
      // correct" rationale silently inverted.
      const anchor = new Date('2026-05-23T00:00:00Z');
      const expected = anchor.getTime() + MIN_UNDO_WINDOW_DAYS * 24 * 60 * 60 * 1000;
      expect(UndoService.defaultExpiresAt(anchor).getTime()).toBe(expected);
      // The floor must never exceed any tier's real window, or the
      // fallback would over-promise for somebody.
      for (const id of TIER_IDS) {
        expect(MIN_UNDO_WINDOW_DAYS).toBeLessThanOrEqual(TIER_MANIFEST[id].undoWindowDays);
      }
    });
  });
});
