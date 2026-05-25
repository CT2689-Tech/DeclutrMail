import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import {
  briefRuns,
  type BriefPayload,
  mailboxAccounts,
  schema,
  users,
  workspaces,
} from '@declutrmail/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { BriefReadService } from './brief.read-service.js';

/**
 * BriefReadService integration tests (D61, D69, D70).
 *
 * Runs the real service against in-process PGlite with every migration
 * applied. Covers tenant isolation, date-range filtering, the D61
 * first-view tracker (`markOpened`), and input validation.
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

async function seedMailbox(
  db: Db,
  email: string,
): Promise<{ workspaceId: string; mailboxAccountId: string }> {
  const [ws] = await db
    .insert(workspaces)
    .values({ name: `WS-${email}` })
    .returning({ id: workspaces.id });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: ws!.id, email })
    .returning({ id: users.id });
  const [mb] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId: ws!.id,
      userId: user!.id,
      provider: 'gmail',
      providerAccountId: email,
    })
    .returning({ id: mailboxAccounts.id });
  return { workspaceId: ws!.id, mailboxAccountId: mb!.id };
}

const SAMPLE_PAYLOAD: BriefPayload = {
  reply: [
    {
      senderKey: 'a'.repeat(64),
      senderName: 'Boss',
      senderEmail: 'boss@example.com',
      subject: 'Q4 plans',
      isVip: true,
      messageIds: ['gmail-1'],
    },
  ],
  fyi: [],
  noise: [],
  narrative: 'One email needs a reply.',
};

async function seedBrief(
  db: Db,
  workspaceId: string,
  mailboxAccountId: string,
  runDateLocal: string,
  opts: { openedAt?: Date | null; payload?: BriefPayload } = {},
): Promise<string> {
  const [row] = await db
    .insert(briefRuns)
    .values({
      workspaceId,
      mailboxAccountId,
      runDateLocal,
      generatedBy: 'template',
      briefPayload: opts.payload ?? SAMPLE_PAYLOAD,
      ...(opts.openedAt !== undefined ? { openedAt: opts.openedAt } : {}),
    })
    .returning({ id: briefRuns.id });
  return row!.id;
}

describe('BriefReadService', () => {
  let db: Db;
  let service: BriefReadService;
  let mailboxA: { workspaceId: string; mailboxAccountId: string };
  let mailboxB: { workspaceId: string; mailboxAccountId: string };

  beforeEach(async () => {
    db = await freshDb();
    service = new BriefReadService(db as never);
    mailboxA = await seedMailbox(db, 'a@example.com');
    mailboxB = await seedMailbox(db, 'b@example.com');
  });

  describe('getForDate', () => {
    it('returns the brief when it exists', async () => {
      await seedBrief(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, '2026-05-25');
      const brief = await service.getForDate(mailboxA.mailboxAccountId, '2026-05-25');
      expect(brief).not.toBeNull();
      expect(brief!.runDateLocal).toBe('2026-05-25');
      expect(brief!.generatedBy).toBe('template');
      expect(brief!.briefPayload.reply).toHaveLength(1);
      expect(brief!.briefPayload.reply[0]!.isVip).toBe(true);
    });

    it('returns null when no brief exists for the date', async () => {
      const brief = await service.getForDate(mailboxA.mailboxAccountId, '2026-05-25');
      expect(brief).toBeNull();
    });

    it('does not leak briefs across tenants', async () => {
      await seedBrief(db, mailboxB.workspaceId, mailboxB.mailboxAccountId, '2026-05-25');
      const brief = await service.getForDate(mailboxA.mailboxAccountId, '2026-05-25');
      expect(brief).toBeNull();
    });

    it('rejects an invalid date format', async () => {
      await expect(
        service.getForDate(mailboxA.mailboxAccountId, '2026/05/25'),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.getForDate(mailboxA.mailboxAccountId, 'today')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('listByRange', () => {
    it('returns briefs in the [from, to] inclusive range, newest first', async () => {
      await seedBrief(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, '2026-05-20');
      await seedBrief(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, '2026-05-22');
      await seedBrief(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, '2026-05-24');
      // Outside range
      await seedBrief(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, '2026-05-15');
      await seedBrief(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, '2026-05-30');

      const list = await service.listByRange(mailboxA.mailboxAccountId, '2026-05-20', '2026-05-24');
      expect(list.map((b) => b.runDateLocal)).toEqual(['2026-05-24', '2026-05-22', '2026-05-20']);
    });

    it('rejects malformed dates', async () => {
      await expect(
        service.listByRange(mailboxA.mailboxAccountId, '2026/05/20', '2026-05-24'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects from > to', async () => {
      await expect(
        service.listByRange(mailboxA.mailboxAccountId, '2026-05-25', '2026-05-20'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('does not leak briefs across tenants', async () => {
      await seedBrief(db, mailboxA.workspaceId, mailboxA.mailboxAccountId, '2026-05-25');
      await seedBrief(db, mailboxB.workspaceId, mailboxB.mailboxAccountId, '2026-05-25');
      const a = await service.listByRange(mailboxA.mailboxAccountId, '2026-05-01', '2026-05-31');
      const b = await service.listByRange(mailboxB.mailboxAccountId, '2026-05-01', '2026-05-31');
      expect(a).toHaveLength(1);
      expect(b).toHaveLength(1);
      expect(a[0]!.id).not.toBe(b[0]!.id);
    });
  });

  describe('markOpened — D61 first-view tracker', () => {
    it('sets opened_at on first call', async () => {
      const id = await seedBrief(
        db,
        mailboxA.workspaceId,
        mailboxA.mailboxAccountId,
        '2026-05-25',
        { openedAt: null },
      );
      const result = await service.markOpened(mailboxA.mailboxAccountId, id);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(id);
      expect(typeof result!.openedAt).toBe('string');

      const [row] = await db
        .select({ openedAt: briefRuns.openedAt })
        .from(briefRuns)
        .where(eq(briefRuns.id, id));
      expect(row!.openedAt).not.toBeNull();
    });

    it('second call returns the existing opened_at (idempotent)', async () => {
      const id = await seedBrief(
        db,
        mailboxA.workspaceId,
        mailboxA.mailboxAccountId,
        '2026-05-25',
        { openedAt: null },
      );
      const first = await service.markOpened(mailboxA.mailboxAccountId, id);
      expect(first).not.toBeNull();
      // Wait a tick so a second `now()` would differ from the first.
      await new Promise((r) => setTimeout(r, 10));
      const second = await service.markOpened(mailboxA.mailboxAccountId, id);
      expect(second).not.toBeNull();
      expect(second!.openedAt).toBe(first!.openedAt);

      const [row] = await db
        .select({ openedAt: briefRuns.openedAt })
        .from(briefRuns)
        .where(eq(briefRuns.id, id));
      // Persisted value matches the first-time set.
      expect(row!.openedAt!.toISOString()).toBe(first!.openedAt);
    });

    it('returns null on cross-tenant attempts', async () => {
      const id = await seedBrief(db, mailboxB.workspaceId, mailboxB.mailboxAccountId, '2026-05-25');
      const result = await service.markOpened(mailboxA.mailboxAccountId, id);
      expect(result).toBeNull();
    });

    it('returns null for unknown id', async () => {
      const result = await service.markOpened(
        mailboxA.mailboxAccountId,
        '00000000-0000-0000-0000-000000000000',
      );
      expect(result).toBeNull();
    });
  });
});
