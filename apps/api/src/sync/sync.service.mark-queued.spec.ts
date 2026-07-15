import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { mailboxAccounts, providerSyncState, schema, users, workspaces } from '@declutrmail/db';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Queue } from 'bullmq';
import type { IncrementalSyncJobData, InitialSyncJobData } from '@declutrmail/workers';

import type { DrizzleDb } from '../db/db.module.js';
import { SyncService } from './sync.service.js';

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

/**
 * Real conflict-update coverage for the two `markQueued` contracts:
 * ordinary retries preserve evidence, while a credential replacement clears
 * only a stale OAuth-grant failure — never an unrelated cursor/history error.
 */
describe('SyncService.markQueued — incremental error lifecycle', () => {
  let pg: PGlite;
  let db: DrizzleDb;
  let service: SyncService;
  let mailboxId: string;

  beforeAll(async () => {
    pg = new PGlite({ extensions: { citext } });
    for (const file of readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith('.sql'))
      .sort()) {
      const migration = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      for (const statement of migration.split('--> statement-breakpoint')) {
        if (statement.trim()) await pg.query(statement.trim());
      }
    }
    db = drizzle(pg, { schema }) as unknown as DrizzleDb;

    const [workspace] = await db.insert(workspaces).values({ name: 'Sync test' }).returning();
    const [user] = await db
      .insert(users)
      .values({ workspaceId: workspace!.id, email: 'sync@example.com' })
      .returning();
    const [mailbox] = await db
      .insert(mailboxAccounts)
      .values({
        workspaceId: workspace!.id,
        userId: user!.id,
        provider: 'gmail',
        providerAccountId: 'sync@example.com',
      })
      .returning();
    mailboxId = mailbox!.id;
    service = new SyncService(
      {} as Queue<InitialSyncJobData>,
      {} as Queue<IncrementalSyncJobData>,
      db,
    );
  });

  afterAll(async () => {
    await pg.close();
  });

  beforeEach(async () => {
    await db.delete(providerSyncState);
  });

  async function seedIncrementalError(code: string, at: Date): Promise<void> {
    await db.insert(providerSyncState).values({
      mailboxAccountId: mailboxId,
      readinessStatus: 'ready',
      currentStage: 'ready',
      progressPct: 100,
      lastIncrementalErrorAt: at,
      lastIncrementalErrorCode: code,
    });
  }

  async function readState() {
    const [row] = await db
      .select()
      .from(providerSyncState)
      .where(eq(providerSyncState.mailboxAccountId, mailboxId));
    return row!;
  }

  it('clears the InvalidGrantError pair after fresh credentials are stored', async () => {
    await seedIncrementalError('InvalidGrantError', new Date('2026-07-12T12:00:00Z'));

    await service.markQueued(db, mailboxId, { freshCredentials: true });

    const row = await readState();
    expect(row.lastIncrementalErrorAt).toBeNull();
    expect(row.lastIncrementalErrorCode).toBeNull();
  });

  it('preserves another error code and its timestamp after fresh credentials', async () => {
    const errorAt = new Date('2026-07-12T13:00:00Z');
    await seedIncrementalError('CursorStaleError', errorAt);

    await service.markQueued(db, mailboxId, { freshCredentials: true });

    const row = await readState();
    expect(row.lastIncrementalErrorAt).toEqual(errorAt);
    expect(row.lastIncrementalErrorCode).toBe('CursorStaleError');
  });

  it('preserves InvalidGrantError by default when no new credentials exist', async () => {
    const errorAt = new Date('2026-07-12T14:00:00Z');
    await seedIncrementalError('InvalidGrantError', errorAt);

    await service.markQueued(db, mailboxId);

    const row = await readState();
    expect(row.lastIncrementalErrorAt).toEqual(errorAt);
    expect(row.lastIncrementalErrorCode).toBe('InvalidGrantError');
  });
});
