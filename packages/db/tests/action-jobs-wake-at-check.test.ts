import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';

import { actionJobs, mailboxAccounts, schema, users, workspaces } from '../src';

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'migrations');

async function freshDb() {
  const pg = new PGlite({ extensions: { citext } });
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((entry) => entry.endsWith('.sql'))
    .sort()) {
    const migration = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const statement of migration.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed) await pg.query(trimmed);
    }
  }
  return drizzle(pg, { schema });
}

async function seedMailbox(db: Awaited<ReturnType<typeof freshDb>>): Promise<string> {
  const [workspace] = await db.insert(workspaces).values({ name: 'WS' }).returning({
    id: workspaces.id,
  });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: workspace!.id, email: 'later-check@example.com' })
    .returning({ id: users.id });
  const [mailbox] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId: workspace!.id,
      userId: user!.id,
      provider: 'gmail',
      providerAccountId: 'later-check@example.com',
    })
    .returning({ id: mailboxAccounts.id });
  return mailbox!.id;
}

function job(mailboxAccountId: string, verb: 'archive' | 'later', wakeAt: Date | null) {
  return {
    mailboxAccountId,
    verb,
    selector: { type: 'messages' } as const,
    idempotencyKey: `${verb}-${wakeAt?.toISOString() ?? 'none'}`,
    wakeAt,
  };
}

describe('action_jobs Later wake_at CHECK (migration 0035)', () => {
  it('requires wake_at for every Later job', async () => {
    const db = await freshDb();
    const mailboxId = await seedMailbox(db);

    await expect(db.insert(actionJobs).values(job(mailboxId, 'later', null))).rejects.toThrow();
    await expect(
      db.insert(actionJobs).values(job(mailboxId, 'later', new Date('2026-08-01T16:00:00Z'))),
    ).resolves.toBeDefined();
  });

  it('forbids wake_at for non-Later jobs while allowing NULL', async () => {
    const db = await freshDb();
    const mailboxId = await seedMailbox(db);

    await expect(
      db.insert(actionJobs).values(job(mailboxId, 'archive', new Date('2026-08-01T16:00:00Z'))),
    ).rejects.toThrow();
    await expect(
      db.insert(actionJobs).values(job(mailboxId, 'archive', null)),
    ).resolves.toBeDefined();
  });
});
