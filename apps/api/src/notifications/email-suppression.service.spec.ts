import { eq } from 'drizzle-orm';
import { users, workspaces } from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { EmailSuppressionService, readSuppression } from './email-suppression.service.js';
import type { DrizzleDb } from '../db/db.module.js';

/**
 * EmailSuppressionService tests (D162) — the no-new-table suppression
 * list in `users.preferences.emailSuppression`, against real PGlite.
 * (`pg.exec` below is PGlite's SQL runner, not child_process.)
 */

async function freshDb(): Promise<DrizzleDb> {
  return (await freshTestDb()) as unknown as DrizzleDb;
}

describe('EmailSuppressionService', () => {
  let db: DrizzleDb;
  let service: EmailSuppressionService;
  let userId: string;

  beforeEach(async () => {
    db = await freshDb();
    service = new EmailSuppressionService(db);
    const [w] = await db.insert(workspaces).values({ name: 'W' }).returning({ id: workspaces.id });
    const [u] = await db
      .insert(users)
      .values({
        workspaceId: w!.id,
        email: 'bounce@x.com',
        preferences: { activeMailboxId: 'keep-me' },
      })
      .returning({ id: users.id });
    userId = u!.id;
  });

  it('suppresses a known recipient and preserves sibling preference keys', async () => {
    expect(await service.isSuppressed('bounce@x.com')).toBe(false);

    const outcome = await service.suppress('bounce@x.com', 'bounce');
    expect(outcome).toBe('suppressed');
    expect(await service.isSuppressed('bounce@x.com')).toBe(true);

    const [row] = await db.select().from(users).where(eq(users.id, userId));
    const prefs = row!.preferences as Record<string, unknown>;
    // jsonb_set adds the key without clobbering the rest of the bag.
    expect(prefs.activeMailboxId).toBe('keep-me');
    expect(readSuppression(prefs)).toMatchObject({ reason: 'bounce', source: 'resend' });
  });

  it('is first-write-wins on replayed webhooks', async () => {
    await service.suppress('bounce@x.com', 'bounce');
    const replay = await service.suppress('bounce@x.com', 'complaint');
    expect(replay).toBe('already_suppressed');
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    expect(readSuppression(row!.preferences)).toMatchObject({ reason: 'bounce' });
  });

  it('reports unknown recipients without writing anything', async () => {
    const outcome = await service.suppress('stranger@elsewhere.com', 'complaint');
    expect(outcome).toBe('unknown_recipient');
    expect(await service.isSuppressed('stranger@elsewhere.com')).toBe(false);
  });

  it('matches recipients case-insensitively (citext email)', async () => {
    await service.suppress('BOUNCE@X.COM', 'bounce');
    expect(await service.isSuppressed('bounce@x.com')).toBe(true);
  });

  it('readSuppression rejects malformed slots', () => {
    expect(readSuppression(null)).toBeNull();
    expect(readSuppression({})).toBeNull();
    expect(readSuppression({ emailSuppression: { reason: 'whatever' } })).toBeNull();
  });
});
