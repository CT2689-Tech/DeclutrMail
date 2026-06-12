import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { mailboxAccounts, schema, users, workspaces } from '@declutrmail/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';

import { GMAIL_WATCH_STATE_KEY, persistGmailWatchState } from './gmail-watch-state.js';
import {
  isQuietActive,
  msUntilQuietEnds,
  persistQuietHoursState,
  QUIET_HOURS_STATE_KEY,
  readQuietHoursState,
} from './quiet-hours-state.js';

/**
 * Quiet-hours jsonb co-tenancy tests (U18 — D92/D93).
 *
 * THE invariant of this unit: `mailbox_accounts.quiet_state` is
 * CO-TENANTED — the Gmail watch pipeline persists under `gmail_watch`,
 * the manual quiet toggle owns the un-namespaced top-level keys, and
 * quiet hours live under `quiet_hours`. Every quiet-hours write MUST
 * be a jsonb `||` MERGE; a whole-column replace would silently wipe
 * `gmail_watch` and kill push notifications (webhook-security audit of
 * PR #209). These tests pin that contract with real jsonb semantics.
 */

const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'db', 'migrations');
const NOW = new Date('2026-06-10T18:00:00Z'); // 23:30 IST

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

async function quietStateOf(db: Awaited<ReturnType<typeof freshDb>>, mailboxId: string) {
  const [row] = await db
    .select({ quietState: mailboxAccounts.quietState })
    .from(mailboxAccounts)
    .where(eq(mailboxAccounts.id, mailboxId));
  return row!.quietState as Record<string, unknown>;
}

const WATCH_STATE = {
  history_id: '123456',
  expiration: '2026-06-18T00:00:00.000Z',
  renewed_at: '2026-06-11T00:00:00.000Z',
};

const CONFIG = {
  enabled: true,
  startLocal: '22:00',
  endLocal: '06:00',
  timezone: 'Asia/Kolkata',
};

describe('persistQuietHoursState', () => {
  it('PRESERVES an existing gmail_watch sibling key (THE co-tenancy invariant)', async () => {
    const db = await freshDb();
    const mailboxId = await seedMailbox(db);
    await persistGmailWatchState(db as never, mailboxId, WATCH_STATE);

    await persistQuietHoursState(db as never, mailboxId, CONFIG, NOW);

    const quiet = await quietStateOf(db, mailboxId);
    // gmail_watch survived the quiet-hours write byte-for-byte.
    expect(quiet[GMAIL_WATCH_STATE_KEY]).toEqual(WATCH_STATE);
    expect(quiet[QUIET_HOURS_STATE_KEY]).toEqual({
      enabled: true,
      start_local: '22:00',
      end_local: '06:00',
      timezone: 'Asia/Kolkata',
      updated_at: NOW.toISOString(),
    });
  });

  it('PRESERVES the manual quiet-toggle top-level keys', async () => {
    const db = await freshDb();
    const mailboxId = await seedMailbox(db, {
      enabled: true,
      source: 'manual',
      until_at: '2026-06-11T00:00:00.000Z',
    });

    await persistQuietHoursState(db as never, mailboxId, CONFIG, NOW);

    const quiet = await quietStateOf(db, mailboxId);
    expect(quiet.enabled).toBe(true);
    expect(quiet.source).toBe('manual');
    expect(quiet.until_at).toBe('2026-06-11T00:00:00.000Z');
    expect(quiet[QUIET_HOURS_STATE_KEY]).toBeDefined();
  });

  it('survives the reverse direction — a watch write after a quiet-hours write', async () => {
    const db = await freshDb();
    const mailboxId = await seedMailbox(db);
    await persistQuietHoursState(db as never, mailboxId, CONFIG, NOW);

    await persistGmailWatchState(db as never, mailboxId, WATCH_STATE);

    const quiet = await quietStateOf(db, mailboxId);
    expect(readQuietHoursState(quiet)).toEqual(CONFIG);
    expect(quiet[GMAIL_WATCH_STATE_KEY]).toEqual(WATCH_STATE);
  });

  it('overwrites a previous config on re-save (replace within the key, merge at top level)', async () => {
    const db = await freshDb();
    const mailboxId = await seedMailbox(db);
    await persistQuietHoursState(db as never, mailboxId, CONFIG, NOW);

    const updated = { ...CONFIG, enabled: false, startLocal: '20:00' };
    await persistQuietHoursState(db as never, mailboxId, updated, NOW);

    expect(readQuietHoursState(await quietStateOf(db, mailboxId))).toEqual(updated);
  });
});

describe('readQuietHoursState', () => {
  it('round-trips a persisted config', async () => {
    const db = await freshDb();
    const mailboxId = await seedMailbox(db);
    await persistQuietHoursState(db as never, mailboxId, CONFIG, NOW);
    expect(readQuietHoursState(await quietStateOf(db, mailboxId))).toEqual(CONFIG);
  });

  it.each([
    ['null', null],
    ['empty object', {}],
    ['manual-toggle-only state', { enabled: true, source: 'manual' }],
    ['foreign key shape', { quiet_hours: { enabled: 'yes' } }],
    ['non-object value', { quiet_hours: 'always' }],
  ])('tolerates %s → null', (_label, value) => {
    expect(readQuietHoursState(value)).toBeNull();
  });
});

describe('isQuietActive (combined predicate)', () => {
  // NOW = 2026-06-10T18:00:00Z = 23:30 IST — inside 22:00–06:00 IST.
  const storedWindow = {
    quiet_hours: {
      enabled: true,
      start_local: '22:00',
      end_local: '06:00',
      timezone: 'Asia/Kolkata',
      updated_at: NOW.toISOString(),
    },
  };

  it('true when the recurring window covers now (manual toggle off)', () => {
    expect(isQuietActive(storedWindow, NOW)).toBe(true);
  });

  it('false when the window does not cover now', () => {
    // 12:00 IST = 06:30 UTC.
    expect(isQuietActive(storedWindow, new Date('2026-06-10T06:30:00Z'))).toBe(false);
  });

  it('false when the window is disabled', () => {
    const disabled = {
      quiet_hours: { ...storedWindow.quiet_hours, enabled: false },
    };
    expect(isQuietActive(disabled, NOW)).toBe(false);
  });

  it('true when only the manual toggle is active', () => {
    const manual = { enabled: true, source: 'manual' };
    expect(isQuietActive(manual, NOW)).toBe(true);
  });

  it('true when the manual toggle is active even outside the window', () => {
    const both = { enabled: true, source: 'manual', ...storedWindow };
    expect(isQuietActive(both, new Date('2026-06-10T06:30:00Z'))).toBe(true);
  });

  it('false for an empty / unconfigured state', () => {
    expect(isQuietActive({}, NOW)).toBe(false);
    expect(isQuietActive(null, NOW)).toBe(false);
  });
});

describe('msUntilQuietEnds', () => {
  const storedWindow = {
    quiet_hours: {
      enabled: true,
      start_local: '22:00',
      end_local: '06:00',
      timezone: 'Asia/Kolkata',
      updated_at: NOW.toISOString(),
    },
  };

  it('null when quiet is not active', () => {
    expect(msUntilQuietEnds({}, NOW)).toBeNull();
    expect(msUntilQuietEnds(storedWindow, new Date('2026-06-10T06:30:00Z'))).toBeNull();
  });

  it('window end across midnight: 23:30 IST → 06:00 IST is 6.5h', () => {
    expect(msUntilQuietEnds(storedWindow, NOW)).toBe(6.5 * 60 * 60_000);
  });

  it('manual quiet with until_at: ms until that instant', () => {
    const manual = {
      enabled: true,
      source: 'manual',
      until_at: new Date(NOW.getTime() + 60 * 60_000).toISOString(),
    };
    expect(msUntilQuietEnds(manual, NOW)).toBe(60 * 60_000);
  });

  it('manual quiet without until_at is indefinite → null (even with an active window)', () => {
    const both = { enabled: true, source: 'manual', ...storedWindow };
    expect(msUntilQuietEnds(both, NOW)).toBeNull();
  });

  it('when both manual until_at and the window are active, the LATER end wins', () => {
    const both = {
      enabled: true,
      source: 'manual',
      until_at: new Date(NOW.getTime() + 60 * 60_000).toISOString(), // 1h
      ...storedWindow, // window ends in 6.5h
    };
    expect(msUntilQuietEnds(both, NOW)).toBe(6.5 * 60 * 60_000);
  });
});
