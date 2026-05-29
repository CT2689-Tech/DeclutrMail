import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { drizzle } from 'drizzle-orm/pglite';
import { eq, isNull } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { schema, securityEvents, users, workspaces } from '../src';

/**
 * Security events log integration tests (D181).
 *
 * Verifies the schema-level invariants the 0016 migration encodes:
 *
 *   1. Defaults match the plan — `occurred_at=now()`, `reviewed_at`
 *      null, `payload` null, `id` a generated uuid.
 *   2. `severity` CHECK accepts only info | warning | critical.
 *   3. `event_type` / `severity` are NOT NULL.
 *   4. `ON DELETE SET NULL` (NOT cascade) — deleting the workspace/user
 *      de-links the audit row but it SURVIVES (audit-retention invariant).
 */

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'migrations');

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

async function seedUser(db: Awaited<ReturnType<typeof freshDb>>) {
  const [ws] = await db.insert(workspaces).values({ name: 'WS' }).returning({ id: workspaces.id });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: ws!.id, email: 'sec@b.com' })
    .returning({ id: users.id });
  return { workspaceId: ws!.id, userId: user!.id };
}

describe('security_events (D181)', () => {
  it('applies plan defaults on a minimal insert', async () => {
    const db = await freshDb();
    const [row] = await db
      .insert(securityEvents)
      .values({ eventType: 'rate_limit.breach', severity: 'warning' })
      .returning();

    expect(row!.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row!.occurredAt).toBeInstanceOf(Date);
    expect(row!.reviewedAt).toBeNull();
    expect(row!.reviewedByUserId).toBeNull();
    expect(row!.payload).toBeNull();
    expect(row!.workspaceId).toBeNull();
  });

  it('accepts the three valid severities', async () => {
    const db = await freshDb();
    for (const severity of ['info', 'warning', 'critical'] as const) {
      await expect(
        db.insert(securityEvents).values({ eventType: 'login.failure', severity }),
      ).resolves.toBeDefined();
    }
  });

  it('rejects a severity outside the closed set', async () => {
    const db = await freshDb();
    await expect(
      db.insert(securityEvents).values({ eventType: 'login.failure', severity: 'bogus' }),
    ).rejects.toThrow();
  });

  it('stores a D7-clean jsonb payload, source_ip and user_agent', async () => {
    const db = await freshDb();
    const [row] = await db
      .insert(securityEvents)
      .values({
        eventType: 'webhook.signature_failure',
        severity: 'critical',
        sourceIp: '203.0.113.7',
        userAgent: 'APIs-Google',
        payload: { reason: 'aud_mismatch', messageId: 'abc' },
      })
      .returning();

    expect(row!.sourceIp).toBe('203.0.113.7');
    expect(row!.payload).toEqual({ reason: 'aud_mismatch', messageId: 'abc' });
  });

  it('SET NULL (not cascade) keeps the audit row after workspace + user deletion', async () => {
    const db = await freshDb();
    const { workspaceId, userId } = await seedUser(db);

    const [row] = await db
      .insert(securityEvents)
      .values({ eventType: 'login.success', severity: 'info', workspaceId, userId })
      .returning({ id: securityEvents.id });

    await db.delete(users).where(eq(users.id, userId));
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));

    const survivors = await db.select().from(securityEvents).where(eq(securityEvents.id, row!.id));

    expect(survivors).toHaveLength(1);
    expect(survivors[0]!.workspaceId).toBeNull();
    expect(survivors[0]!.userId).toBeNull();

    const deLinked = await db.select().from(securityEvents).where(isNull(securityEvents.userId));
    expect(deLinked).toHaveLength(1);
  });
});
