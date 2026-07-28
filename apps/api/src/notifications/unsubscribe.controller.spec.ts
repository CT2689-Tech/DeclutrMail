import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { schema, users, workspaces } from '@declutrmail/db';
import { beforeAll, describe, expect, it } from 'vitest';

import { UnsubscribeController } from './unsubscribe.controller.js';
import { signUnsubscribeToken } from './unsubscribe-token.js';
import type { DrizzleDb } from '../db/db.module.js';

/**
 * UnsubscribeController tests (D165) — real PGlite, because the write
 * is a single atomic `jsonb_set` statement whose semantics (row-lock
 * read, intermediate-path no-op, key preservation) a fake db cannot
 * exercise. The monotonic property under test: this unauthenticated
 * endpoint can only ever turn preferences OFF.
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

describe('UnsubscribeController', () => {
  beforeAll(() => {
    process.env.UNSUBSCRIBE_TOKEN_SECRET = 'y'.repeat(32);
  });

  it('scope "all" stops EVERY opt-out-able category, not just one', async () => {
    // The compliance case: a footer link labelled plainly "Unsubscribe"
    // must stop all optional mail (CAN-SPAM §316.5). Turning off only
    // the category that happened to carry the link would leave a
    // sibling arriving — the user unsubscribes, still gets email, marks
    // it spam.
    const db = await freshDb();
    const userId = await seedUser(db, {});
    const controller = new UnsubscribeController(db);
    const token = await signUnsubscribeToken({ userId, scope: 'all' });

    const res = await controller.unsubscribe(token);

    expect(res.status).toBe('ok');
    expect(await readPrefs(db, userId)).toEqual({
      emailPrefs: { reminders: false, syncComplete: false },
    });
  });

  it('a single-category scope still narrows to just that key', async () => {
    // Granular tokens remain honoured (never-expiring links), and must
    // leave the sibling category untouched rather than defaulted.
    const db = await freshDb();
    const userId = await seedUser(db, {});
    const controller = new UnsubscribeController(db);
    const token = await signUnsubscribeToken({ userId, scope: 'reminders' });

    await controller.unsubscribe(token);

    // Only the flipped key exists — the write must not bake today's
    // defaults (syncComplete: true) into storage.
    expect(await readPrefs(db, userId)).toEqual({ emailPrefs: { reminders: false } });
  });

  it('returns ok for an invalid token and writes nothing', async () => {
    const db = await freshDb();
    const userId = await seedUser(db, { emailPrefs: { reminders: true } });
    const controller = new UnsubscribeController(db);

    const res = await controller.unsubscribe('garbage');

    expect(res.status).toBe('ok');
    expect(await readPrefs(db, userId)).toEqual({ emailPrefs: { reminders: true } });
  });

  it('returns ok for a missing token and writes nothing', async () => {
    const db = await freshDb();
    const userId = await seedUser(db, {});
    const controller = new UnsubscribeController(db);

    const res = await controller.unsubscribe(undefined);

    expect(res.status).toBe('ok');
    expect(await readPrefs(db, userId)).toEqual({});
  });

  it('returns ok when the user row is gone', async () => {
    const db = await freshDb();
    const controller = new UnsubscribeController(db);
    const token = await signUnsubscribeToken({
      userId: '00000000-0000-4000-8000-00000000dead',
      scope: 'all',
    });

    const res = await controller.unsubscribe(token);

    expect(res.status).toBe('ok');
  });

  it('never resurrects an existing opt-out — only narrows', async () => {
    // The user already opted out of reminders; unsubscribing must not
    // flip anything back ON.
    const db = await freshDb();
    const userId = await seedUser(db, { emailPrefs: { reminders: false } });
    const controller = new UnsubscribeController(db);
    const token = await signUnsubscribeToken({ userId, scope: 'all' });

    await controller.unsubscribe(token);

    expect(await readPrefs(db, userId)).toEqual({
      emailPrefs: { reminders: false, syncComplete: false },
    });
  });

  it('preserves stored keys it does not recognise', async () => {
    // A bag written by a future release (or a corrupted one) must pass
    // through untouched apart from the single flipped category.
    const db = await freshDb();
    const userId = await seedUser(db, {
      profilePreset: 'calm',
      emailPrefs: { reminders: false, futureCategory: true },
    });
    const controller = new UnsubscribeController(db);
    const token = await signUnsubscribeToken({ userId, scope: 'all' });

    await controller.unsubscribe(token);

    expect(await readPrefs(db, userId)).toEqual({
      profilePreset: 'calm',
      emailPrefs: { reminders: false, futureCategory: true, syncComplete: false },
    });
  });

  it('repairs a malformed non-object ROOT instead of erroring', async () => {
    // jsonb_set with a text path on an ARRAY root raises an error —
    // which would turn the uniform 200 into a 500. The statement must
    // repair the root to an object first.
    const db = await freshDb();
    const userId = await seedUser(db, [1, 2] as unknown as Record<string, unknown>);
    const controller = new UnsubscribeController(db);
    const token = await signUnsubscribeToken({ userId, scope: 'all' });

    const res = await controller.unsubscribe(token);

    expect(res.status).toBe('ok');
    expect(await readPrefs(db, userId)).toEqual({
      emailPrefs: { reminders: false, syncComplete: false },
    });
  });

  it('replaces a malformed non-object emailPrefs instead of no-opping', async () => {
    // jsonb_set silently no-ops when an intermediate path step is not
    // an object — the CASE arm must repair the bag so the opt-out
    // actually lands.
    const db = await freshDb();
    const userId = await seedUser(db, { emailPrefs: 'corrupted' });
    const controller = new UnsubscribeController(db);
    const token = await signUnsubscribeToken({ userId, scope: 'all' });

    await controller.unsubscribe(token);

    expect(await readPrefs(db, userId)).toEqual({
      emailPrefs: { reminders: false, syncComplete: false },
    });
  });

  it('GET never mutates, even with a perfectly valid token', async () => {
    const db = await freshDb();
    const userId = await seedUser(db, { emailPrefs: { reminders: true } });
    const controller = new UnsubscribeController(db);
    const token = await signUnsubscribeToken({ userId, scope: 'all' });

    // Link prefetchers (Outlook Safe Links, malware scanners) issue this
    // GET without any human involved. If it mutated, a scanner would
    // unsubscribe users from mail they never opened.
    const html = await controller.confirmPage(token);

    expect(await readPrefs(db, userId)).toEqual({ emailPrefs: { reminders: true } });
    expect(html).toContain('<form method="POST"');
    expect(html).toContain('Unsubscribe');
  });

  it('GET escapes the token into the form action', async () => {
    const db = await freshDb();
    const controller = new UnsubscribeController(db);

    const html = await controller.confirmPage('a"><script>alert(1)</script>');

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&quot;');
  });
});
