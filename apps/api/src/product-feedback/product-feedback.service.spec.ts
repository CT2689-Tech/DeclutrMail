import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import {
  activityLog,
  briefRuns,
  followupTracker,
  mailboxAccounts,
  productFeedback,
  schema,
  users,
  workspaces,
} from '@declutrmail/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

import { ProductFeedbackService } from './product-feedback.service.js';

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
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    const contents = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const statement of contents.split('--> statement-breakpoint')) {
      if (statement.trim()) await pg.query(statement.trim());
    }
  }
  return drizzle(pg, { schema });
}

async function seedPrincipal(db: Db, email: string) {
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: email })
    .returning({ id: workspaces.id });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: workspace!.id, email })
    .returning({ id: users.id });
  const [mailbox] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId: workspace!.id,
      userId: user!.id,
      provider: 'gmail',
      providerAccountId: email,
    })
    .returning({ id: mailboxAccounts.id });
  return {
    principal: { userId: user!.id, workspaceId: workspace!.id },
    mailboxId: mailbox!.id,
  };
}

describe('ProductFeedbackService', () => {
  let db: Db;
  let service: ProductFeedbackService;

  beforeEach(async () => {
    db = await freshDb();
    service = new ProductFeedbackService(db as never);
  });

  it('upserts one user rating for an owned automatic Activity row', async () => {
    const owner = await seedPrincipal(db, 'owner@example.com');
    const [activity] = await db
      .insert(activityLog)
      .values({
        mailboxAccountId: owner.mailboxId,
        source: 'autopilot',
        action: 'archive',
      })
      .returning({ id: activityLog.id });

    await service.submit(owner.principal, owner.mailboxId, {
      surface: 'activity',
      referenceId: activity!.id,
      rating: 'expected',
    });
    const updated = await service.submit(owner.principal, owner.mailboxId, {
      surface: 'activity',
      referenceId: activity!.id,
      rating: 'surprising',
    });

    expect(updated.rating).toBe('surprising');
    const rows = await db.select().from(productFeedback);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: owner.principal.userId,
      mailboxAccountId: owner.mailboxId,
      activityLogId: activity!.id,
      briefRunId: null,
      rating: 'surprising',
    });
  });

  it('does not reveal cross-mailbox, manual, or missing Activity references', async () => {
    const owner = await seedPrincipal(db, 'owner@example.com');
    const other = await seedPrincipal(db, 'other@example.com');
    const [manual] = await db
      .insert(activityLog)
      .values({ mailboxAccountId: owner.mailboxId, source: 'manual', action: 'archive' })
      .returning({ id: activityLog.id });

    await expect(
      service.submit(other.principal, other.mailboxId, {
        surface: 'activity',
        referenceId: manual!.id,
        rating: 'expected',
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service.submit(owner.principal, owner.mailboxId, {
        surface: 'activity',
        referenceId: manual!.id,
        rating: 'expected',
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(await db.select().from(productFeedback)).toHaveLength(0);
  });

  it('persists only typed references for owned Brief and Followup rows', async () => {
    const owner = await seedPrincipal(db, 'owner@example.com');
    const [brief] = await db
      .insert(briefRuns)
      .values({
        workspaceId: owner.principal.workspaceId,
        mailboxAccountId: owner.mailboxId,
        runDateLocal: '2026-07-15',
        generatedBy: 'template',
      })
      .returning({ id: briefRuns.id });
    const [followup] = await db
      .insert(followupTracker)
      .values({
        workspaceId: owner.principal.workspaceId,
        mailboxAccountId: owner.mailboxId,
        providerThreadId: 'provider-thread-never-returned',
        recipientEmail: 'recipient@example.com',
        sentAt: new Date(),
      })
      .returning({ id: followupTracker.id });

    await service.submit(owner.principal, owner.mailboxId, {
      surface: 'brief',
      referenceId: brief!.id,
      rating: 'wrong_reason',
    });
    await service.submit(owner.principal, owner.mailboxId, {
      surface: 'followups',
      referenceId: followup!.id,
      rating: 'not_followup',
    });

    const rows = await db
      .select()
      .from(productFeedback)
      .where(eq(productFeedback.userId, owner.principal.userId));
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ briefRunId: brief!.id, rating: 'wrong_reason' }),
        expect.objectContaining({ followupTrackerId: followup!.id, rating: 'not_followup' }),
      ]),
    );
  });
});
