import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import {
  accountDeletionRequests,
  mailboxAccounts,
  schema,
  securityEvents,
  undoJournal,
  users,
  workspaces,
} from '@declutrmail/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Queue } from 'bullmq';

import type { EmailSendJobData } from '@declutrmail/workers';

import { SecurityEventsService } from '../security-events/security-events.service.js';
import { UndoService } from '../undo/undo.service.js';
import { AccountDeletionOrchestrator } from './deletion.service.js';

/**
 * AccountDeletionOrchestrator integration tests (D205, D216, D232).
 *
 * Real service against PGlite with every migration applied — covers the
 * D232 projection math (per-USER undo aggregate across ≥2 mailboxes),
 * the typed-phrase gate (D216), the waiver path, the one-in-flight
 * unique constraint, cancel semantics, and the audit + email side
 * effects.
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

/** Captures `enqueueEmailSend` calls without Redis. */
function fakeEmailQueue(): { queue: Queue<EmailSendJobData>; jobs: EmailSendJobData[] } {
  const jobs: EmailSendJobData[] = [];
  const queue = {
    getJob: async () => undefined,
    add: async (_name: string, data: EmailSendJobData) => {
      jobs.push(data);
    },
  } as unknown as Queue<EmailSendJobData>;
  return { queue, jobs };
}

async function seedUser(db: Db): Promise<{ userId: string; workspaceId: string }> {
  const [ws] = await db.insert(workspaces).values({ name: 'WS' }).returning({ id: workspaces.id });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: ws!.id, email: 'owner@declutrmail.ai' })
    .returning({ id: users.id });
  return { userId: user!.id, workspaceId: ws!.id };
}

async function addMailbox(
  db: Db,
  workspaceId: string,
  userId: string,
  address: string,
): Promise<string> {
  const [mb] = await db
    .insert(mailboxAccounts)
    .values({ workspaceId, userId, provider: 'gmail', providerAccountId: address })
    .returning({ id: mailboxAccounts.id });
  return mb!.id;
}

describe('AccountDeletionOrchestrator', () => {
  let db: Db;
  let userId: string;
  let workspaceId: string;
  let emailJobs: EmailSendJobData[];
  let orch: AccountDeletionOrchestrator;

  beforeEach(async () => {
    db = await freshDb();
    ({ userId, workspaceId } = await seedUser(db));
    const fake = fakeEmailQueue();
    emailJobs = fake.jobs;
    orch = new AccountDeletionOrchestrator(
      db as never,
      new UndoService(db as never),
      new SecurityEventsService(db as never),
      fake.queue,
    );
  });

  describe('computeProjection — D232 per-USER math', () => {
    const NOW = new Date('2026-05-23T00:00:00Z');
    const FLAT_GRACE = new Date('2026-05-30T00:00:00Z'); // now + 7d

    it('flat-grace when no active undo tokens', async () => {
      const p = await orch.computeProjection(userId, NOW);
      expect(p.projectedBasis).toBe('flat-grace');
      expect(p.projectedEffectiveAt).toBe(FLAT_GRACE.toISOString());
      expect(p.latestUndoExpiresAt).toBeNull();
      expect(p.activeUndoCount).toBe(0);
    });

    it('undo-window when a token on ANOTHER mailbox extends past the grace (per-USER fix)', async () => {
      const mb1 = await addMailbox(db, workspaceId, userId, 'a@x.com');
      const mb2 = await addMailbox(db, workspaceId, userId, 'b@x.com');
      const near = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
      const far = new Date(Date.now() + 25 * 24 * 60 * 60 * 1000);
      await db.insert(undoJournal).values([
        { mailboxAccountId: mb1, actionKind: 'archive', payload: {}, expiresAt: near },
        { mailboxAccountId: mb2, actionKind: 'archive', payload: {}, expiresAt: far },
      ]);

      const p = await orch.computeProjection(userId);
      expect(p.projectedBasis).toBe('undo-window');
      expect(p.projectedEffectiveAt).toBe(far.toISOString());
      expect(p.activeUndoCount).toBe(2);
    });

    it('flat-grace when the undo window is shorter', async () => {
      const mb1 = await addMailbox(db, workspaceId, userId, 'a@x.com');
      const near = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
      await db
        .insert(undoJournal)
        .values({ mailboxAccountId: mb1, actionKind: 'archive', payload: {}, expiresAt: near });

      const p = await orch.computeProjection(userId);
      expect(p.projectedBasis).toBe('flat-grace');
      expect(p.latestUndoExpiresAt).toBe(near.toISOString());
    });

    it('exact tie ⇒ flat-grace (the contract baseline wins on equality)', async () => {
      const mb1 = await addMailbox(db, workspaceId, userId, 'a@x.com');
      const tie = new Date('2026-05-30T00:00:00Z');
      await db
        .insert(undoJournal)
        .values({ mailboxAccountId: mb1, actionKind: 'archive', payload: {}, expiresAt: tie });
      const p = await orch.computeProjection(userId, NOW);
      expect(p.projectedBasis).toBe('flat-grace');
      expect(p.projectedEffectiveAt).toBe(FLAT_GRACE.toISOString());
    });
  });

  describe('requestDeletion — typed phrase gate (D216)', () => {
    it('rejects a wrong phrase with DELETION_CONFIRM_MISMATCH', async () => {
      await expect(
        orch.requestDeletion({ userId }, { confirmPhrase: 'delete' }),
      ).rejects.toMatchObject({ code: 'DELETION_CONFIRM_MISMATCH' });
      const rows = await db.select().from(accountDeletionRequests);
      expect(rows).toHaveLength(0);
    });

    it('DELETE schedules at the D232 max-of date and audits + emails', async () => {
      const before = Date.now();
      const status = await orch.requestDeletion({ userId }, { confirmPhrase: 'DELETE' });

      expect(status.request).not.toBeNull();
      expect(status.request!.basis).toBe('flat-grace');
      expect(status.request!.waiverConfirmed).toBe(false);
      const effective = new Date(status.request!.effectiveAt).getTime();
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      expect(effective - before).toBeGreaterThan(sevenDays - 10_000);
      expect(effective - before).toBeLessThan(sevenDays + 10_000);

      // Audit row.
      const events = await db
        .select()
        .from(securityEvents)
        .where(eq(securityEvents.eventType, 'account.deletion_requested'));
      expect(events).toHaveLength(1);
      expect(events[0]!.userId).toBe(userId);

      // Scheduled email enqueued, idempotency keyed on the request id.
      expect(emailJobs).toHaveLength(1);
      expect(emailJobs[0]!.kind).toBe('deletion-scheduled');
      expect(emailJobs[0]!.idempotencyKey).toBe(`email__deletion-scheduled__${status.request!.id}`);
      expect(emailJobs[0]!.text).toContain('/settings');
    });

    it('an open undo window extends the scheduled date (basis undo-window)', async () => {
      const mb1 = await addMailbox(db, workspaceId, userId, 'a@x.com');
      const far = new Date(Date.now() + 25 * 24 * 60 * 60 * 1000);
      await db
        .insert(undoJournal)
        .values({ mailboxAccountId: mb1, actionKind: 'archive', payload: {}, expiresAt: far });

      const status = await orch.requestDeletion({ userId }, { confirmPhrase: 'DELETE' });
      expect(status.request!.basis).toBe('undo-window');
      expect(status.request!.effectiveAt).toBe(far.toISOString());
    });

    it('DELETE AND WAIVE UNDO ⇒ waived-immediate, effective now', async () => {
      const mb1 = await addMailbox(db, workspaceId, userId, 'a@x.com');
      const far = new Date(Date.now() + 25 * 24 * 60 * 60 * 1000);
      await db
        .insert(undoJournal)
        .values({ mailboxAccountId: mb1, actionKind: 'archive', payload: {}, expiresAt: far });

      const before = Date.now();
      const status = await orch.requestDeletion(
        { userId },
        { confirmPhrase: 'DELETE AND WAIVE UNDO' },
      );
      expect(status.request!.basis).toBe('waived-immediate');
      expect(status.request!.waiverConfirmed).toBe(true);
      const effective = new Date(status.request!.effectiveAt).getTime();
      expect(effective).toBeGreaterThanOrEqual(before - 5_000);
      expect(effective).toBeLessThanOrEqual(Date.now() + 5_000);
    });

    it('second request while one is pending ⇒ DELETION_ALREADY_PENDING', async () => {
      await orch.requestDeletion({ userId }, { confirmPhrase: 'DELETE' });
      await expect(
        orch.requestDeletion({ userId }, { confirmPhrase: 'DELETE' }),
      ).rejects.toMatchObject({ code: 'DELETION_ALREADY_PENDING' });
    });
  });

  describe('cancel + re-request', () => {
    it('cancel flips pending → cancelled and audits', async () => {
      await orch.requestDeletion({ userId }, { confirmPhrase: 'DELETE' });
      const status = await orch.cancel(userId);
      expect(status.request).toBeNull();

      const [row] = await db.select().from(accountDeletionRequests);
      expect(row!.status).toBe('cancelled');
      expect(row!.cancelledAt).not.toBeNull();

      const events = await db
        .select()
        .from(securityEvents)
        .where(eq(securityEvents.eventType, 'account.deletion_cancelled'));
      expect(events).toHaveLength(1);
    });

    it('cancel with nothing pending ⇒ NO_PENDING_DELETION', async () => {
      await expect(orch.cancel(userId)).rejects.toMatchObject({ code: 'NO_PENDING_DELETION' });
    });

    it('re-request after cancel creates a fresh pending request + fresh email', async () => {
      await orch.requestDeletion({ userId }, { confirmPhrase: 'DELETE' });
      await orch.cancel(userId);
      const status = await orch.requestDeletion({ userId }, { confirmPhrase: 'DELETE' });
      expect(status.request!.status).toBe('pending');
      expect(emailJobs).toHaveLength(2);
      expect(emailJobs[1]!.idempotencyKey).toBe(`email__deletion-scheduled__${status.request!.id}`);
    });
  });

  describe('getStatus', () => {
    it('returns null request + projection when nothing is in flight', async () => {
      const status = await orch.getStatus(userId);
      expect(status.request).toBeNull();
      expect(status.projection.projectedBasis).toBe('flat-grace');
    });

    it('returns the pending request while one is in flight', async () => {
      const requested = await orch.requestDeletion({ userId }, { confirmPhrase: 'DELETE' });
      const status = await orch.getStatus(userId);
      expect(status.request?.id).toBe(requested.request!.id);
      expect(status.request?.status).toBe('pending');
    });
  });
});
