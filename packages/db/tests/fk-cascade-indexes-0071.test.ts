import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

/**
 * Every foreign key in `public` must have a covering index (mig 0071).
 *
 * A CLASS guard, not an instance one. Ten FKs were unindexed on prod
 * 2026-08-23, and the reason is structural: Postgres indexes the PARENT
 * side of a foreign key automatically and the CHILD side never. So the
 * gap reappears every time someone adds a `.references(...)` without
 * remembering the index — which is exactly what happened ten times.
 *
 * The cost lands on DELETE: each unindexed FK forces one sequential
 * scan of the child table per deleted parent row. That is the
 * account-deletion path (D205, D216, D232), which has a legal clock on
 * it, and the undo-expiry cron, which deletes every tick.
 *
 * A composite index counts when the FK columns are a LEADING prefix —
 * `(mailbox_account_id, sender_key)` covers a FK on `mailbox_account_id`
 * — which is why this asks Postgres rather than comparing name lists.
 */
async function migratedDb(): Promise<PGlite> {
  const pg = new PGlite({ extensions: { citext } });
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of sql.split('--> statement-breakpoint')) {
      const trimmed = stmt.trim();
      // PGlite runs `query()` in an implicit transaction where
      // CONCURRENTLY is illegal; the keyword must survive in the file
      // (prod tables are live) and be dropped here. Same trade as
      // `fresh-db.ts` — PGlite is an oracle for schema SHAPE, not for
      // locking behaviour.
      if (trimmed) await pg.query(trimmed.replace(/\bCONCURRENTLY\b/gi, ''));
    }
  }
  return pg;
}

const UNINDEXED_FK_SQL = `
  SELECT c.conname AS fk, t.relname AS child_table
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  WHERE c.contype = 'f'
    AND t.relnamespace = 'public'::regnamespace
    AND NOT EXISTS (
      SELECT 1 FROM pg_index i
      WHERE i.indrelid = c.conrelid
        AND (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] @> c.conkey
    )
  ORDER BY c.conname`;

describe('foreign-key cascade indexes', () => {
  let pg: PGlite;

  beforeAll(async () => {
    pg = await migratedDb();
  });

  it('sees a non-empty foreign-key population', async () => {
    // THE BLIND CASE, asserted FIRST. The guard below is a filter over a
    // fetch: if the fetch returned nothing — wrong schema, migrations
    // that silently did not apply — the filter is vacuously clean and
    // reports a pass having verified nothing. This is the input starve.
    const { rows } = await pg.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       WHERE c.contype = 'f' AND t.relnamespace = 'public'::regnamespace`,
    );
    expect(rows[0]!.n).toBeGreaterThan(20);
  });

  it('covers every foreign key with an index', async () => {
    const { rows } = await pg.query<{ fk: string; child_table: string }>(UNINDEXED_FK_SQL);
    expect(rows).toEqual([]);
  });

  it('detects an unindexed foreign key when one is introduced', async () => {
    // The guard's own negative control. Without this, a query that can
    // never return a row would pass forever and nobody would know —
    // which is how the ten FKs above went unnoticed in the first place.
    await pg.exec(`
      CREATE TABLE public.fk_guard_probe (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE
      )`);
    const { rows } = await pg.query<{ fk: string; child_table: string }>(UNINDEXED_FK_SQL);
    expect(rows.map((r) => r.child_table)).toContain('fk_guard_probe');
    await pg.exec('DROP TABLE public.fk_guard_probe');
  });
});
