import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { mailboxAccounts, schema, users, workspaces } from '@declutrmail/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';

import {
  clearGmailWatchState,
  GMAIL_WATCH_STATE_KEY,
  persistGmailWatchState,
  readGmailWatchState,
} from './gmail-watch-state.js';

/**
 * Gmail watch-state jsonb co-tenancy tests (D8/D225).
 *
 * The watch state lives under the reserved `gmail_watch` key inside
 * `mailbox_accounts.quiet_state` (packages/db is frozen — see the
 * helper's header). These tests pin the contract that makes that safe:
 * writes are MERGES, the clear is a single-key delete, and quiet-mode
 * keys survive both.
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

async function seedMailbox(
  db: Awaited<ReturnType<typeof freshDb>>,
  quietState: Record<string, unknown> = {},
): Promise<string> {
  const [ws] = await db.insert(workspaces).values({ name: 'WS' }).returning({ id: workspaces.id });
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
      quietState,
    })
    .returning({ id: mailboxAccounts.id });
  return mb!.id;
}

const STATE = {
  history_id: '123456',
  expiration: '2026-06-18T00:00:00.000Z',
  renewed_at: '2026-06-11T00:00:00.000Z',
};

async function quietStateOf(db: Awaited<ReturnType<typeof freshDb>>, mailboxId: string) {
  const [row] = await db
    .select({ quietState: mailboxAccounts.quietState })
    .from(mailboxAccounts)
    .where(eq(mailboxAccounts.id, mailboxId));
  return row!.quietState as Record<string, unknown>;
}

describe('persistGmailWatchState', () => {
  it('writes the state under the reserved key and PRESERVES quiet-mode keys', async () => {
    const db = await freshDb();
    const mailboxId = await seedMailbox(db, { enabled: true, source: 'manual' });

    await persistGmailWatchState(db as never, mailboxId, STATE);

    const quiet = await quietStateOf(db, mailboxId);
    expect(quiet[GMAIL_WATCH_STATE_KEY]).toEqual(STATE);
    // Quiet-mode co-tenants survive — the write is a merge, not a replace.
    expect(quiet.enabled).toBe(true);
    expect(quiet.source).toBe('manual');
  });

  it('overwrites a previous watch state on re-watch (renewal)', async () => {
    const db = await freshDb();
    const mailboxId = await seedMailbox(db);

    await persistGmailWatchState(db as never, mailboxId, STATE);
    const renewed = { ...STATE, history_id: '999', renewed_at: '2026-06-11T06:00:00.000Z' };
    await persistGmailWatchState(db as never, mailboxId, renewed);

    const quiet = await quietStateOf(db, mailboxId);
    expect(quiet[GMAIL_WATCH_STATE_KEY]).toEqual(renewed);
  });
});

describe('clearGmailWatchState', () => {
  it('removes ONLY the watch key — quiet-mode keys survive', async () => {
    const db = await freshDb();
    const mailboxId = await seedMailbox(db, { enabled: false });
    await persistGmailWatchState(db as never, mailboxId, STATE);

    await clearGmailWatchState(db as never, mailboxId);

    const quiet = await quietStateOf(db, mailboxId);
    expect(quiet[GMAIL_WATCH_STATE_KEY]).toBeUndefined();
    expect(quiet.enabled).toBe(false);
  });

  it('is a no-op when no watch state exists', async () => {
    const db = await freshDb();
    const mailboxId = await seedMailbox(db);
    await clearGmailWatchState(db as never, mailboxId);
    expect(await quietStateOf(db, mailboxId)).toEqual({});
  });
});

describe('readGmailWatchState', () => {
  it('round-trips a persisted state', async () => {
    const db = await freshDb();
    const mailboxId = await seedMailbox(db);
    await persistGmailWatchState(db as never, mailboxId, STATE);
    expect(readGmailWatchState(await quietStateOf(db, mailboxId))).toEqual(STATE);
  });

  it.each([
    ['null', null],
    ['empty object', {}],
    ['foreign key shape', { gmail_watch: { history_id: 7 } }],
    ['non-object value', { gmail_watch: 'yes' }],
  ])('tolerates %s → null', (_label, value) => {
    expect(readGmailWatchState(value)).toBeNull();
  });
});
