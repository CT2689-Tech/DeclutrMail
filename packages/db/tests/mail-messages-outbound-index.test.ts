import { freshTestPglite } from '../src/testing/index.js';
import { describe, expect, it } from 'vitest';

/**
 * Migration 0065 is the first migration in this repo to ship
 * `CREATE INDEX CONCURRENTLY` (LEARNINGS 2026-05-21 — `mail_messages` is
 * live in production and a plain `CREATE INDEX` would lock it).
 *
 * PGlite cannot run `CONCURRENTLY` inside its implicit transaction, so
 * `fresh-db.ts` strips the keyword when it replays migrations. That strip
 * is the thing this test guards: if it ever silently turned the statement
 * into a no-op — or a future edit dropped the migration — every other spec
 * would still pass, because nothing else asserts this index exists. The
 * summary query would just quietly go back to a Seq Scan.
 */
describe('migration 0065 — outbound partial index', () => {
  it('exists after a full migration replay, despite the CONCURRENTLY strip', async () => {
    const pg = await freshTestPglite();
    try {
      const res = await pg.query<{ indexdef: string }>(
        `SELECT indexdef FROM pg_indexes
         WHERE tablename = 'mail_messages'
           AND indexname = 'mail_messages_account_outbound_idx'`,
      );
      expect(res.rows).toHaveLength(1);
      // Partial, on the mailbox scope — the shape the `replied` CTE needs.
      expect(res.rows[0]?.indexdef).toMatch(/mailbox_account_id/);
      expect(res.rows[0]?.indexdef).toMatch(/WHERE .*is_outbound/i);
    } finally {
      await pg.close();
    }
  });
});
