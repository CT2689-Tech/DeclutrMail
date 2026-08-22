import { describe, expect, it } from 'vitest';

import { freshTestPglite } from '../src/testing/index.js';

/**
 * Migration 0069 — autovacuum tuning on the four hot tables.
 *
 * These tables sit at or below Postgres' default vacuum trigger
 * (`50 + 0.2 * n_live_tup`) during normal operation, so autovacuum
 * stops firing and the VISIBILITY MAP goes stale. A page that is not
 * all-visible cannot be answered from an index alone, so every "Index
 * Only Scan" degrades into an index scan plus a heap fetch per row.
 *
 * Measured on production 2026-08-22, same query and plan, with only a
 * manual `VACUUM (ANALYZE)` in between: the /api/senders list query
 * went 7,526 ms -> 953 ms while its buffer count barely moved
 * (42,666 -> 40,745). The per-buffer cost fell from 176 us to 23 us.
 * That gap is the heap fetches this migration keeps from coming back.
 *
 * The assertion is on `pg_class.reloptions` after a FULL migration
 * replay, so it fails if 0069 is reverted, reordered behind a later
 * `ALTER TABLE ... RESET`, or if a table is renamed out from under it.
 */

/** Tables 0069 tunes, and the settings each must carry afterwards. */
const TUNED_TABLES = ['mail_messages', 'senders', 'triage_decisions', 'sender_timeseries'];

const EXPECTED_OPTIONS = [
  'autovacuum_vacuum_scale_factor=0.05',
  'autovacuum_vacuum_insert_scale_factor=0.05',
  'autovacuum_analyze_scale_factor=0.02',
];

describe('migration 0069 — autovacuum hot-table tuning', () => {
  it('leaves every hot table with a tighter-than-default vacuum trigger', async () => {
    const pg = await freshTestPglite();
    const res = await pg.query<{ relname: string; reloptions: string[] | null }>(
      `SELECT c.relname, c.reloptions
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = ANY($1)
        ORDER BY c.relname`,
      [TUNED_TABLES],
    );

    expect(res.rows.map((r) => r.relname)).toEqual([...TUNED_TABLES].sort());

    for (const row of res.rows) {
      const options = row.reloptions ?? [];
      for (const expected of EXPECTED_OPTIONS) {
        expect(options, `${row.relname} reloptions`).toContain(expected);
      }
    }
  });

  it('sets a vacuum scale factor strictly below the 0.2 default', async () => {
    // The point of the migration is the THRESHOLD, not the literal
    // string. Assert the number so a future retune that keeps the key
    // but loosens the value past the default still fails here.
    const pg = await freshTestPglite();
    const res = await pg.query<{ relname: string; scale_factor: string | null }>(
      `SELECT c.relname,
              substring(o FROM 'autovacuum_vacuum_scale_factor=(.*)') AS scale_factor
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN LATERAL unnest(coalesce(c.reloptions, '{}')) AS o
        WHERE n.nspname = 'public'
          AND c.relname = ANY($1)
          AND o LIKE 'autovacuum_vacuum_scale_factor=%'`,
      [TUNED_TABLES],
    );

    expect(res.rows).toHaveLength(TUNED_TABLES.length);
    for (const row of res.rows) {
      expect(Number(row.scale_factor), `${row.relname} scale factor`).toBeLessThan(0.2);
    }
  });
});
