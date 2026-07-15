import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import {
  activityLog,
  followupTracker,
  mailboxAccounts,
  productFeedback,
  schema,
  senderPolicies,
  users,
  workspaces,
} from '@declutrmail/db';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { FollowupReadService } from './followup.read-service.js';

/** Mirror of the read-service's local sender-key derivation. */
function senderKeyFor(email: string): string {
  const lowered = email.trim().toLowerCase();
  const at = lowered.lastIndexOf('@');
  let normalized = lowered;
  if (at > 0) {
    const local = lowered.slice(0, at);
    const domain = lowered.slice(at);
    const plus = local.indexOf('+');
    normalized = plus > 0 ? `${local.slice(0, plus)}${domain}` : lowered;
  }
  return createHash('sha256').update(`v1|${normalized}`).digest('hex');
}

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
): Promise<{ workspaceId: string; userId: string; mailboxAccountId: string }> {
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
  return { workspaceId: ws!.id, userId: user!.id, mailboxAccountId: mb!.id };
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
  let mailboxA: { workspaceId: string; userId: string; mailboxAccountId: string };
  let mailboxB: { workspaceId: string; userId: string; mailboxAccountId: string };

  beforeEach(async () => {
    db = await freshDb();
    service = new FollowupReadService(db as never);
    mailboxA = await seedMailbox(db, 'a@example.com');
    mailboxB = await seedMailbox(db, 'b@example.com');
  });

  describe('listAwaiting', () => {
    it('projects the current user rating for an observed follow-up', async () => {
      const followupId = await seedFollowup(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, {
        threadId: 'rated',
        sentAt: new Date(NOW_MS - 2 * 24 * 60 * 60 * 1000),
      });
      await db.insert(productFeedback).values({
        workspaceId: mailboxA.workspaceId,
        userId: mailboxA.userId,
        mailboxAccountId: mailboxA.mailboxAccountId,
        surface: 'followups',
        rating: 'not_followup',
        followupTrackerId: followupId,
      });

      const rows = await service.listAwaiting(mailboxA.mailboxAccountId, mailboxA.userId, NOW_MS);
      expect(rows[0]!.feedbackRating).toBe('not_followup');
    });

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

    it('D85 — orders oldest first by sent_at (longest-overdue surfaces first)', async () => {
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
      // Oldest first — the high-priority overdue thread leads the list.
      expect(list.map((f) => f.subject)).toEqual(['older', 'newer']);
      expect(list[0]!.priority).toBe('high');
      expect(list[1]!.priority).toBe('low');
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

  describe('D86 read-side exclusion via sender_policies', () => {
    it('excludes followups whose recipient is marked Archive in this mailbox', async () => {
      await seedFollowup(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, {
        threadId: 't-arc',
        sentAt: new Date(NOW_MS - 5 * 24 * 60 * 60 * 1000),
        subject: 'archived-recipient',
        recipientEmail: 'archive-me@example.com',
      });
      await seedFollowup(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, {
        threadId: 't-keep',
        sentAt: new Date(NOW_MS - 4 * 24 * 60 * 60 * 1000),
        subject: 'kept-recipient',
        recipientEmail: 'boss@example.com',
      });
      // User marked archive-me@example.com as Archive in DeclutrMail.
      await db.insert(senderPolicies).values({
        mailboxAccountId: mailboxA.mailboxAccountId,
        senderKey: senderKeyFor('archive-me@example.com'),
        policyType: 'archive',
      });

      const list = await service.listAwaiting(mailboxA.mailboxAccountId, NOW_MS);
      expect(list.map((f) => f.subject)).toEqual(['kept-recipient']);
    });

    it('excludes followups whose recipient is marked Unsubscribe', async () => {
      await seedFollowup(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, {
        threadId: 't-unsub',
        sentAt: new Date(NOW_MS - 5 * 24 * 60 * 60 * 1000),
        subject: 'unsub-recipient',
        recipientEmail: 'unsub-me@example.com',
      });
      await db.insert(senderPolicies).values({
        mailboxAccountId: mailboxA.mailboxAccountId,
        senderKey: senderKeyFor('unsub-me@example.com'),
        policyType: 'unsubscribe',
      });

      const list = await service.listAwaiting(mailboxA.mailboxAccountId, NOW_MS);
      expect(list).toHaveLength(0);
    });

    it('does NOT exclude followups whose recipient is marked Keep or Later', async () => {
      await seedFollowup(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, {
        threadId: 't-keep',
        sentAt: new Date(NOW_MS - 5 * 24 * 60 * 60 * 1000),
        subject: 'keep-policy',
        recipientEmail: 'keep@example.com',
      });
      await seedFollowup(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, {
        threadId: 't-later',
        sentAt: new Date(NOW_MS - 4 * 24 * 60 * 60 * 1000),
        subject: 'later-policy',
        recipientEmail: 'later@example.com',
      });
      await db.insert(senderPolicies).values([
        {
          mailboxAccountId: mailboxA.mailboxAccountId,
          senderKey: senderKeyFor('keep@example.com'),
          policyType: 'keep',
        },
        {
          mailboxAccountId: mailboxA.mailboxAccountId,
          senderKey: senderKeyFor('later@example.com'),
          policyType: 'later',
        },
      ]);

      const list = await service.listAwaiting(mailboxA.mailboxAccountId, NOW_MS);
      // Both kept — Archive/Unsubscribe is the only exclusion axis for
      // D86 here; Keep and Later mean the user wants this correspondence.
      expect(list.map((f) => f.subject).sort()).toEqual(['keep-policy', 'later-policy']);
    });

    it('multi-mailbox: mailbox A archive policy does NOT exclude mailbox B followup with the same recipient', async () => {
      // Same recipient address across two mailboxes — A archived them,
      // B did not. The Drizzle correlated-subquery pitfall would let A's
      // policy mask B's row (or vice versa) if the join leaked across
      // mailboxes. This test fails if the per-mailbox scope drops.
      const recipient = 'shared-contact@example.com';
      await seedFollowup(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, {
        threadId: 'a-thread',
        sentAt: new Date(NOW_MS - 5 * 24 * 60 * 60 * 1000),
        subject: 'a-followup',
        recipientEmail: recipient,
      });
      await seedFollowup(db, mailboxB.workspaceId, mailboxB.mailboxAccountId, {
        threadId: 'b-thread',
        sentAt: new Date(NOW_MS - 5 * 24 * 60 * 60 * 1000),
        subject: 'b-followup',
        recipientEmail: recipient,
      });
      await db.insert(senderPolicies).values({
        mailboxAccountId: mailboxA.mailboxAccountId,
        senderKey: senderKeyFor(recipient),
        policyType: 'archive',
      });

      const a = await service.listAwaiting(mailboxA.mailboxAccountId, NOW_MS);
      const b = await service.listAwaiting(mailboxB.mailboxAccountId, NOW_MS);
      // A's archive policy excludes A's row.
      expect(a).toHaveLength(0);
      // B has no policy → B's row remains visible.
      expect(b.map((f) => f.subject)).toEqual(['b-followup']);
    });

    it('multi-mailbox: mailbox B archive policy does NOT exclude mailbox A followup with the same recipient (reciprocal)', async () => {
      // Reciprocal of the previous test — the correlated-subquery
      // pitfall is symmetric, so we cover both directions.
      const recipient = 'shared-contact@example.com';
      await seedFollowup(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, {
        threadId: 'a-thread',
        sentAt: new Date(NOW_MS - 5 * 24 * 60 * 60 * 1000),
        subject: 'a-followup',
        recipientEmail: recipient,
      });
      await seedFollowup(db, mailboxB.workspaceId, mailboxB.mailboxAccountId, {
        threadId: 'b-thread',
        sentAt: new Date(NOW_MS - 5 * 24 * 60 * 60 * 1000),
        subject: 'b-followup',
        recipientEmail: recipient,
      });
      await db.insert(senderPolicies).values({
        mailboxAccountId: mailboxB.mailboxAccountId,
        senderKey: senderKeyFor(recipient),
        policyType: 'archive',
      });

      const a = await service.listAwaiting(mailboxA.mailboxAccountId, NOW_MS);
      const b = await service.listAwaiting(mailboxB.mailboxAccountId, NOW_MS);
      expect(a.map((f) => f.subject)).toEqual(['a-followup']);
      expect(b).toHaveLength(0);
    });

    it('LIMIT-before-filter regression: surfaces eligible rows even when the oldest page is mostly excluded', async () => {
      // Regression for the [P2] review finding on PR #111: the old impl
      // applied LIMIT 100 in SQL and THEN filtered Archive/Unsubscribe
      // recipients in TS. If the oldest 100 awaiting rows happened to be
      // archived senders, the endpoint returned an empty list even
      // though eligible followups existed deeper in the backlog.
      //
      // Seeding 120 archived + 30 eligible (eligible newer than
      // archived so they live PAST the LIMIT-100 cutoff under the old
      // impl). With the new over-fetch loop we must surface all 30.
      const baseMs = NOW_MS - 30 * 24 * 60 * 60 * 1000;

      // 120 archived-recipient followups, OLDER than the eligible ones.
      const archivedRecipient = (i: number) => `archived-${i}@example.com`;
      for (let i = 0; i < 120; i += 1) {
        await seedFollowup(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, {
          threadId: `arc-${i}`,
          // i = 0 oldest, i = 119 newest among the archived block.
          sentAt: new Date(baseMs + i * 1000),
          recipientEmail: archivedRecipient(i),
          subject: `archived-${i}`,
        });
      }
      // Archive policy for every one of them — picks up via sender_key.
      await db.insert(senderPolicies).values(
        Array.from({ length: 120 }, (_unused, i) => ({
          mailboxAccountId: mailboxA.mailboxAccountId,
          senderKey: senderKeyFor(archivedRecipient(i)),
          policyType: 'archive' as const,
        })),
      );

      // 30 eligible-recipient followups, NEWER (so they sort after the
      // 120 archived ones). Under the old LIMIT-100-then-filter impl,
      // the first SQL page captured only archived rows (indices 0-99)
      // and the eligible rows never surfaced — the endpoint returned 0.
      for (let i = 0; i < 30; i += 1) {
        await seedFollowup(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, {
          threadId: `elig-${i}`,
          sentAt: new Date(baseMs + (120 + i) * 1000),
          recipientEmail: `eligible-${i}@example.com`,
          subject: `eligible-${i}`,
        });
      }

      const list = await service.listAwaiting(mailboxA.mailboxAccountId, NOW_MS);
      // Must surface every eligible row even though the first 120
      // awaiting rows by sent_at ASC are excluded.
      expect(list).toHaveLength(30);
      const subjects = list.map((f) => f.subject);
      // None of the archived recipients leaked through.
      expect(subjects.every((s) => s.startsWith('eligible-'))).toBe(true);
      // Ordering preserved — oldest eligible first.
      expect(subjects[0]).toBe('eligible-0');
      expect(subjects[29]).toBe('eligible-29');
    });

    it('handles +suffix alias normalization (recipient with +tag matches base policy)', async () => {
      // D12 — sender_key normalization strips the local-part +suffix
      // alias. A policy keyed on `boss@example.com` should match a
      // followup with `boss+chase@example.com`.
      await seedFollowup(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, {
        threadId: 't',
        sentAt: new Date(NOW_MS - 5 * 24 * 60 * 60 * 1000),
        recipientEmail: 'boss+chase@example.com',
      });
      await db.insert(senderPolicies).values({
        mailboxAccountId: mailboxA.mailboxAccountId,
        senderKey: senderKeyFor('boss@example.com'),
        policyType: 'archive',
      });

      const list = await service.listAwaiting(mailboxA.mailboxAccountId, NOW_MS);
      expect(list).toHaveLength(0);
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
      expect(result!.alreadyDismissed).toBe(false);

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

    it('second dismiss of the same row returns alreadyDismissed:true with the original dismissedAt', async () => {
      // Phase-1 idempotency contract (D202/D207): repeat dismiss for
      // the same (mailbox, followup) is a benign replay — it MUST NOT
      // collapse to 404 (indistinguishable from "missing") and the
      // terminal `dismissedAt` MUST match the first call.
      const id = await seedFollowup(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, {
        threadId: 't',
        sentAt: new Date(NOW_MS - 2 * 24 * 60 * 60 * 1000),
      });
      const first = await service.dismiss(mailboxA.mailboxAccountId, id);
      expect(first).not.toBeNull();
      expect(first!.alreadyDismissed).toBe(false);
      const second = await service.dismiss(mailboxA.mailboxAccountId, id);
      expect(second).not.toBeNull();
      expect(second!.status).toBe('dismissed');
      expect(second!.alreadyDismissed).toBe(true);
      expect(second!.dismissedAt).toBe(first!.dismissedAt);

      // The audit row from the first dismiss must NOT be duplicated by
      // the replay — D207 stored-result semantics.
      const audit = await db
        .select({ id: activityLog.id })
        .from(activityLog)
        .where(eq(activityLog.mailboxAccountId, mailboxA.mailboxAccountId));
      expect(audit).toHaveLength(1);
    });

    it('cross-tenant repeat-dismiss still returns null (404) — alreadyDismissed bypass is per-mailbox', async () => {
      // Dismiss B's row as B, then attempt the same id as A. Must NOT
      // leak "row exists / is dismissed" via a 200.
      const id = await seedFollowup(db, mailboxB.workspaceId, mailboxB.mailboxAccountId, {
        threadId: 't',
        sentAt: new Date(NOW_MS - 2 * 24 * 60 * 60 * 1000),
      });
      const dismissedAsB = await service.dismiss(mailboxB.mailboxAccountId, id);
      expect(dismissedAsB).not.toBeNull();
      expect(dismissedAsB!.alreadyDismissed).toBe(false);
      const crossTenant = await service.dismiss(mailboxA.mailboxAccountId, id);
      expect(crossTenant).toBeNull();
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
