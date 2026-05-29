import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { schema, securityEvents, users, workspaces } from '@declutrmail/db';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

import { SecurityEventsReadService } from './security-events-read.service.js';

/**
 * SecurityEventsReadService integration tests (D181 read surface).
 *
 * Runs the real service against an in-process PGlite database with
 * every migration applied. Exercises:
 *
 *   - severity / event_type / from / to filter SQL
 *   - keyset cursor pagination on (occurred_at DESC, id DESC)
 *   - ordering invariant — newest first, deterministic on tie
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
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
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

async function seedUser(db: Db, email: string): Promise<{ userId: string; workspaceId: string }> {
  const [ws] = await db
    .insert(workspaces)
    .values({ name: `WS-${email}` })
    .returning({ id: workspaces.id });
  const [u] = await db
    .insert(users)
    .values({ workspaceId: ws!.id, email })
    .returning({ id: users.id });
  return { userId: u!.id, workspaceId: ws!.id };
}

interface SeedEventArgs {
  eventType: string;
  severity: 'info' | 'warning' | 'critical';
  occurredAt: Date;
  workspaceId?: string | null;
  userId?: string | null;
  payload?: Record<string, unknown> | null;
}

async function seedEvent(db: Db, args: SeedEventArgs): Promise<string> {
  const [row] = await db
    .insert(securityEvents)
    .values({
      eventType: args.eventType,
      severity: args.severity,
      occurredAt: args.occurredAt,
      workspaceId: args.workspaceId ?? null,
      userId: args.userId ?? null,
      payload: args.payload ?? null,
    })
    .returning({ id: securityEvents.id });
  return row!.id;
}

describe('SecurityEventsReadService.list (D181)', () => {
  let db: Db;
  let service: SecurityEventsReadService;

  beforeEach(async () => {
    db = await freshDb();
    service = new SecurityEventsReadService(
      db as unknown as ConstructorParameters<typeof SecurityEventsReadService>[0],
    );
  });

  describe('ordering', () => {
    it('returns rows newest first (occurred_at DESC)', async () => {
      await seedEvent(db, {
        eventType: 'login.failure',
        severity: 'warning',
        occurredAt: new Date('2026-05-29T10:00:00Z'),
      });
      await seedEvent(db, {
        eventType: 'login.failure',
        severity: 'warning',
        occurredAt: new Date('2026-05-29T12:00:00Z'),
      });
      await seedEvent(db, {
        eventType: 'login.failure',
        severity: 'warning',
        occurredAt: new Date('2026-05-29T11:00:00Z'),
      });

      const rows = await service.list({ limit: 10, cursor: null });
      expect(rows.map((r) => r.occurredAt.toISOString())).toEqual([
        '2026-05-29T12:00:00.000Z',
        '2026-05-29T11:00:00.000Z',
        '2026-05-29T10:00:00.000Z',
      ]);
    });
  });

  describe('filters', () => {
    it('severity narrows to one tier', async () => {
      await seedEvent(db, {
        eventType: 'login.failure',
        severity: 'warning',
        occurredAt: new Date('2026-05-29T10:00:00Z'),
      });
      await seedEvent(db, {
        eventType: 'rate_limit.breach',
        severity: 'critical',
        occurredAt: new Date('2026-05-29T11:00:00Z'),
      });
      await seedEvent(db, {
        eventType: 'rate_limit.breach',
        severity: 'info',
        occurredAt: new Date('2026-05-29T12:00:00Z'),
      });

      const crit = await service.list({ severity: 'critical', limit: 10, cursor: null });
      expect(crit.map((r) => r.eventType)).toEqual(['rate_limit.breach']);
      expect(crit[0]?.severity).toBe('critical');
    });

    it('eventType narrows to one kind', async () => {
      await seedEvent(db, {
        eventType: 'login.failure',
        severity: 'warning',
        occurredAt: new Date('2026-05-29T10:00:00Z'),
      });
      await seedEvent(db, {
        eventType: 'webhook.signature_failure',
        severity: 'warning',
        occurredAt: new Date('2026-05-29T11:00:00Z'),
      });

      const rows = await service.list({
        eventType: 'webhook.signature_failure',
        limit: 10,
        cursor: null,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.eventType).toBe('webhook.signature_failure');
    });

    it('from / to bound occurred_at inclusively', async () => {
      await seedEvent(db, {
        eventType: 'login.failure',
        severity: 'warning',
        occurredAt: new Date('2026-05-28T00:00:00Z'),
      });
      await seedEvent(db, {
        eventType: 'login.failure',
        severity: 'warning',
        occurredAt: new Date('2026-05-29T12:00:00Z'),
      });
      await seedEvent(db, {
        eventType: 'login.failure',
        severity: 'warning',
        occurredAt: new Date('2026-05-30T00:00:00Z'),
      });

      const rows = await service.list({
        from: new Date('2026-05-29T00:00:00Z'),
        to: new Date('2026-05-29T23:59:59Z'),
        limit: 10,
        cursor: null,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.occurredAt.toISOString()).toBe('2026-05-29T12:00:00.000Z');
    });

    it('combines all filters as AND', async () => {
      const ctx = await seedUser(db, 'ops@x.example');
      await seedEvent(db, {
        eventType: 'login.failure',
        severity: 'warning',
        occurredAt: new Date('2026-05-29T10:00:00Z'),
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
      });
      await seedEvent(db, {
        eventType: 'login.failure',
        severity: 'critical', // wrong severity
        occurredAt: new Date('2026-05-29T11:00:00Z'),
      });
      await seedEvent(db, {
        eventType: 'rate_limit.breach', // wrong type
        severity: 'warning',
        occurredAt: new Date('2026-05-29T12:00:00Z'),
      });
      await seedEvent(db, {
        eventType: 'login.failure',
        severity: 'warning',
        occurredAt: new Date('2026-04-29T10:00:00Z'), // outside window
      });

      const rows = await service.list({
        eventType: 'login.failure',
        severity: 'warning',
        from: new Date('2026-05-29T00:00:00Z'),
        to: new Date('2026-05-29T23:59:59Z'),
        limit: 10,
        cursor: null,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.userId).toBe(ctx.userId);
      expect(rows[0]?.workspaceId).toBe(ctx.workspaceId);
    });
  });

  describe('cursor pagination', () => {
    it('walks all rows across two pages, no duplicates, no gaps', async () => {
      // Seed 5 events at distinct minutes for deterministic ordering.
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        const id = await seedEvent(db, {
          eventType: 'login.failure',
          severity: 'warning',
          occurredAt: new Date(`2026-05-29T1${i}:00:00Z`),
        });
        ids.push(id);
      }

      const page1 = await service.list({ limit: 2, cursor: null });
      expect(page1).toHaveLength(2);
      // Newest first: 14:00, 13:00
      expect(page1[0]?.occurredAt.toISOString()).toBe('2026-05-29T14:00:00.000Z');
      expect(page1[1]?.occurredAt.toISOString()).toBe('2026-05-29T13:00:00.000Z');

      // Continue from the boundary of page1.
      const last = page1[page1.length - 1]!;
      const page2 = await service.list({
        limit: 2,
        cursor: { key: last.occurredAt.toISOString(), id: last.id },
      });
      expect(page2).toHaveLength(2);
      expect(page2[0]?.occurredAt.toISOString()).toBe('2026-05-29T12:00:00.000Z');
      expect(page2[1]?.occurredAt.toISOString()).toBe('2026-05-29T11:00:00.000Z');

      // Last page (1 row).
      const last2 = page2[page2.length - 1]!;
      const page3 = await service.list({
        limit: 2,
        cursor: { key: last2.occurredAt.toISOString(), id: last2.id },
      });
      expect(page3).toHaveLength(1);
      expect(page3[0]?.occurredAt.toISOString()).toBe('2026-05-29T10:00:00.000Z');
    });

    it('breaks ties on id when two rows share occurred_at (deterministic ordering)', async () => {
      // Two events at the SAME timestamp — the (occurred_at, id) keyset
      // pair must order them deterministically by id DESC and the
      // cursor must skip cleanly between them.
      const ts = new Date('2026-05-29T15:00:00Z');
      const a = await seedEvent(db, {
        eventType: 'login.failure',
        severity: 'warning',
        occurredAt: ts,
      });
      const b = await seedEvent(db, {
        eventType: 'login.failure',
        severity: 'warning',
        occurredAt: ts,
      });

      const page1 = await service.list({ limit: 1, cursor: null });
      expect(page1).toHaveLength(1);
      const firstId = page1[0]!.id;
      const expectedSecondId = firstId === a ? b : a;

      const page2 = await service.list({
        limit: 1,
        cursor: { key: ts.toISOString(), id: firstId },
      });
      expect(page2).toHaveLength(1);
      expect(page2[0]?.id).toBe(expectedSecondId);
    });
  });
});
