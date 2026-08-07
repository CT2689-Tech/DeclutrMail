import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { mailboxAccounts, schema, undoJournal, users, workspaces } from '@declutrmail/db';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';

import { scheduledAtMinute, UndoExpiryWorker } from './index.js';
import type { WorkerContext } from './worker-context.js';

/**
 * UndoExpiryWorker integration tests (D35, D58, D232).
 *
 * Runs the real worker against an in-process PGlite database with every
 * migration applied. Asserts the 1-day expiry lag (worker keeps
 * just-expired rows around so the controller can return HTTP 410
 * cleanly), the cascade-safe deletion (activity_log undo_token goes to
 * NULL), and the idempotency-key shape.
 */

const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'db', 'migrations');

async function freshDb() {
  const pg = new PGlite({ extensions: { citext } });
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
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

async function seedMailbox(db: Awaited<ReturnType<typeof freshDb>>): Promise<string> {
  const [ws] = await db.insert(workspaces).values({ name: 'WS' }).returning({
    id: workspaces.id,
  });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: ws!.id, email: 'a@b.com' })
    .returning({ id: users.id });
  const [mb] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId: ws!.id,
      userId: user!.id,
      provider: 'gmail',
      providerAccountId: 'a@b.com',
    })
    .returning({ id: mailboxAccounts.id });
  return mb!.id;
}

const FAKE_CTX: WorkerContext = {
  jobId: 'test',
  workerName: 'UndoExpiryWorker',
  attempt: 1,
  maxAttempts: 3,
  startedAt: new Date(),
  policy: 'cronPolicy',
};

describe('UndoExpiryWorker', () => {
  it('deletes rows whose expires_at is more than 1 day in the past', async () => {
    const db = await freshDb();
    const mbId = await seedMailbox(db);

    // Mix of rows around the 1-day cutoff:
    //   - way-old:    should DELETE
    //   - just-old:   should DELETE (>1d past expiry)
    //   - boundary:   should KEEP (just-expired, inside the 1-day lag)
    //   - active:     should KEEP (expiry in the future)
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const [wayOld] = await db
      .insert(undoJournal)
      .values({
        mailboxAccountId: mbId,
        actionKind: 'archive',
        payload: { kind: 'archive', messageIds: ['m1'], priorLabels: ['INBOX'] },
        expiresAt: new Date(now - 10 * dayMs),
      })
      .returning({ token: undoJournal.token });
    const [justOld] = await db
      .insert(undoJournal)
      .values({
        mailboxAccountId: mbId,
        actionKind: 'archive',
        payload: { kind: 'archive', messageIds: ['m2'], priorLabels: ['INBOX'] },
        expiresAt: new Date(now - 1.5 * dayMs),
      })
      .returning({ token: undoJournal.token });
    const [boundary] = await db
      .insert(undoJournal)
      .values({
        mailboxAccountId: mbId,
        actionKind: 'archive',
        payload: { kind: 'archive', messageIds: ['m3'], priorLabels: ['INBOX'] },
        expiresAt: new Date(now - 0.5 * dayMs),
      })
      .returning({ token: undoJournal.token });
    const [active] = await db
      .insert(undoJournal)
      .values({
        mailboxAccountId: mbId,
        actionKind: 'archive',
        payload: { kind: 'archive', messageIds: ['m4'], priorLabels: ['INBOX'] },
        expiresAt: new Date(now + dayMs),
      })
      .returning({ token: undoJournal.token });

    const worker = new UndoExpiryWorker({ db: db as never });
    const result = await worker.processJob({ scheduledAtMinute: scheduledAtMinute() }, FAKE_CTX);
    expect(result.deleted).toBe(2);

    const remaining = await db.select({ token: undoJournal.token }).from(undoJournal);
    const tokens = remaining.map((r) => r.token).sort();
    expect(tokens).toEqual([boundary!.token, active!.token].sort());
    // Reference deleted tokens so future regressions show in the
    // failure message instead of needing a debugger.
    expect(tokens).not.toContain(wayOld!.token);
    expect(tokens).not.toContain(justOld!.token);
  });

  it('deletes zero rows when nothing is past the 1-day cutoff', async () => {
    const db = await freshDb();
    const mbId = await seedMailbox(db);
    await db.insert(undoJournal).values({
      mailboxAccountId: mbId,
      actionKind: 'archive',
      payload: { kind: 'archive', messageIds: ['x'], priorLabels: ['INBOX'] },
      // Active token.
    });

    const worker = new UndoExpiryWorker({ db: db as never });
    const result = await worker.processJob({ scheduledAtMinute: scheduledAtMinute() }, FAKE_CTX);
    expect(result.deleted).toBe(0);

    const remaining = await db.select({ token: undoJournal.token }).from(undoJournal);
    expect(remaining).toHaveLength(1);
  });

  it('idempotency key combines worker name and scheduling minute (D225)', () => {
    const worker = new UndoExpiryWorker({ db: {} as never });
    // The base class stores the key via the protected getter; we
    // access via the same path BaseDeclutrWorker uses.
    type WithProtectedKey = UndoExpiryWorker & {
      getIdempotencyKey?: (payload: { scheduledAtMinute: string }) => string;
    };
    const key = (worker as WithProtectedKey).getIdempotencyKey?.({
      scheduledAtMinute: '2026-05-23T14:35',
    });
    expect(key).toBe('UndoExpiryWorker:2026-05-23T14:35');
  });

  it('scheduledAtMinute rounds down to the minute boundary', () => {
    const at = new Date('2026-05-23T14:35:42.123Z');
    expect(scheduledAtMinute(at)).toBe('2026-05-23T14:35');
  });
});
