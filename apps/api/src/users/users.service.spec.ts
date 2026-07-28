import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { InternalServerErrorException } from '@nestjs/common';
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { schema, users, workspaces } from '@declutrmail/db';
import { describe, expect, it } from 'vitest';

import { UsersService } from './users.service.js';
import type { DrizzleDb } from '../db/db.module.js';

/**
 * UsersService preference-write tests — real PGlite, because both
 * writes are single atomic jsonb statements (`||` shallow merge and
 * the nested `jsonb_set` emailPrefs merge) whose lost-update immunity
 * is exactly what a fake db cannot exercise. The property under test:
 * a write touches ONLY the keys its patch carries, so a concurrent
 * writer's key (e.g. a D165 one-click unsubscribe flip) survives.
 */

const MIG_DIR = join(__dirname, '../../../../packages/db/migrations');

async function freshDb(): Promise<DrizzleDb> {
  const pg = new PGlite({ extensions: { citext } });
  const files = readdirSync(MIG_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    await pg.exec(readFileSync(join(MIG_DIR, file), 'utf8'));
  }
  const db = drizzle(pg, { schema }) as unknown as PgliteDatabase<typeof schema>;
  return db as unknown as DrizzleDb;
}

async function seedUser(db: DrizzleDb, preferences: Record<string, unknown>): Promise<string> {
  const [w] = await db.insert(workspaces).values({ name: 'W' }).returning({ id: workspaces.id });
  const [u] = await db
    .insert(users)
    .values({ workspaceId: w!.id, email: 'a@b.com', preferences })
    .returning({ id: users.id });
  return u!.id;
}

async function readPrefs(db: DrizzleDb, userId: string): Promise<Record<string, unknown>> {
  const [row] = await db
    .select({ preferences: users.preferences })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row!.preferences as Record<string, unknown>;
}

describe('UsersService.patchPreferences', () => {
  it('merges only the patched top-level keys', async () => {
    const db = await freshDb();
    const userId = await seedUser(db, {
      activeMailboxId: 'm-1',
      emailPrefs: { reminders: false },
    });
    const svc = new UsersService(db);

    await svc.patchPreferences(userId, { onboardingSkipped: true });

    // The unrelated keys — including a concurrent-style unsubscribe
    // flip — are untouched.
    expect(await readPrefs(db, userId)).toEqual({
      activeMailboxId: 'm-1',
      emailPrefs: { reminders: false },
      onboardingSkipped: true,
    });
  });

  it('replaces an existing key with the patched value, null included', async () => {
    const db = await freshDb();
    const userId = await seedUser(db, { activeMailboxId: 'm-1' });
    const svc = new UsersService(db);

    await svc.patchPreferences(userId, { activeMailboxId: null });

    expect(await readPrefs(db, userId)).toEqual({ activeMailboxId: null });
  });

  it('throws when the user does not exist', async () => {
    const db = await freshDb();
    const svc = new UsersService(db);

    await expect(
      svc.patchPreferences('00000000-0000-4000-8000-00000000dead', { a: 1 }),
    ).rejects.toThrow(InternalServerErrorException);
  });
});

describe('UsersService.mergeEmailPrefs', () => {
  it('merges only the carried sub-keys and preserves the rest', async () => {
    const db = await freshDb();
    const userId = await seedUser(db, {
      activeMailboxId: 'm-1',
      emailPrefs: { reminders: false, futureCategory: true },
    });
    const svc = new UsersService(db);

    const preferences = await svc.mergeEmailPrefs(userId, { syncComplete: false });

    const expected = {
      activeMailboxId: 'm-1',
      emailPrefs: { reminders: false, futureCategory: true, syncComplete: false },
    };
    expect(preferences).toEqual(expected);
    expect(await readPrefs(db, userId)).toEqual(expected);
  });

  it('stores sparsely — no defaults materialised', async () => {
    const db = await freshDb();
    const userId = await seedUser(db, {});
    const svc = new UsersService(db);

    await svc.mergeEmailPrefs(userId, { reminders: true });

    expect(await readPrefs(db, userId)).toEqual({ emailPrefs: { reminders: true } });
  });

  it('repairs a malformed non-object emailPrefs', async () => {
    const db = await freshDb();
    const userId = await seedUser(db, { emailPrefs: 'corrupted' });
    const svc = new UsersService(db);

    await svc.mergeEmailPrefs(userId, { reminders: false });

    expect(await readPrefs(db, userId)).toEqual({ emailPrefs: { reminders: false } });
  });

  it('throws when the user does not exist', async () => {
    const db = await freshDb();
    const svc = new UsersService(db);

    await expect(
      svc.mergeEmailPrefs('00000000-0000-4000-8000-00000000dead', { reminders: false }),
    ).rejects.toThrow(InternalServerErrorException);
  });
});
