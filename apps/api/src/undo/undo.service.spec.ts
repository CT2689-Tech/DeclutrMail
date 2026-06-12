import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { mailboxAccounts, schema, users, workspaces } from '@declutrmail/db';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

import { UndoService } from './undo.service.js';
import type { UndoPayload } from './undo.types.js';

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

      // Default expiry: 7 days from createdAt. Allow generous slop for
      // SQL `now()` vs test wall-clock.
      const expiryMs = entry.expiresAt.getTime();
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      expect(expiryMs - before).toBeGreaterThan(sevenDaysMs - 5_000);
      expect(expiryMs - after).toBeLessThan(sevenDaysMs + 5_000);
    });

    it('honors an explicit expires_at (Pro tier 30-day window)', async () => {
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

  describe('listActive', () => {
    it('returns only not-reverted, not-expired tokens, newest first', async () => {
      const active1 = await svc.issue({
        mailboxAccountId: mailboxId,
        actionKind: 'archive',
        payload: archivePayload,
      });
      // small delay so created_at differs
      await new Promise((r) => setTimeout(r, 10));
      const active2 = await svc.issue({
        mailboxAccountId: mailboxId,
        actionKind: 'later',
        payload: { kind: 'later', messageIds: ['m1'], priorLabels: ['INBOX'] },
      });
      const expired = await svc.issue({
        mailboxAccountId: mailboxId,
        actionKind: 'archive',
        payload: archivePayload,
        expiresAt: new Date(Date.now() - 60_000),
      });
      const reverted = await svc.issue({
        mailboxAccountId: mailboxId,
        actionKind: 'archive',
        payload: archivePayload,
      });
      await svc.claimForRevert(reverted.token, mailboxId);
      await svc.recordRevertSuccess(reverted.token);

      const rows = await svc.listActive(mailboxId);
      const tokens = rows.map((r) => r.token);
      expect(tokens).toContain(active1.token);
      expect(tokens).toContain(active2.token);
      expect(tokens).not.toContain(expired.token);
      expect(tokens).not.toContain(reverted.token);
      // Newest first — active2 came after active1.
      expect(tokens.indexOf(active2.token)).toBeLessThan(tokens.indexOf(active1.token));
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
    it('returns 7 days from the provided anchor', () => {
      const anchor = new Date('2026-05-23T00:00:00Z');
      const expected = new Date('2026-05-30T00:00:00Z');
      expect(UndoService.defaultExpiresAt(anchor).getTime()).toBe(expected.getTime());
    });
  });
});
