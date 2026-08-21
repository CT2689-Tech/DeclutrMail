import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { describe, expect, it } from 'vitest';

import { freshTestPglite } from '../src/testing/index.js';

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'migrations');

function readSql(file: string): string {
  return readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
}

async function applySql(pg: PGlite, sql: string): Promise<void> {
  for (const stmt of sql.split('--> statement-breakpoint')) {
    const trimmed = stmt.trim();
    if (trimmed) await pg.query(trimmed.replace(/\bCONCURRENTLY\b/gi, ''));
  }
}

/**
 * Migration 0068 — search_path pin, anon/authenticated REVOKE, webhook_dedup FK index.
 *
 * The snapshot helper (`freshTestPglite`) is the oracle for schema shape
 * after every migration. The privilege test cannot use that snapshot:
 * it has to GRANT mid-replay so the REVOKE has something to take away.
 */
describe('migration 0068 — security + webhook FK index', () => {
  it('pins dm_normalize_email search_path after a full replay', async () => {
    const pg = await freshTestPglite();
    const res = await pg.query<{ proconfig: string[] | null }>(
      `SELECT proconfig
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'dm_normalize_email'`,
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]?.proconfig?.join(',')).toMatch(/search_path=/);
    expect(res.rows[0]?.proconfig?.join(',')).toMatch(/pg_catalog/);
  });

  it('adds webhook_dedup_mailbox_account_id_idx despite the CONCURRENTLY strip', async () => {
    const pg = await freshTestPglite();
    const res = await pg.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE tablename = 'webhook_dedup'
          AND indexname = 'webhook_dedup_mailbox_account_id_idx'`,
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]?.indexdef).toMatch(/mailbox_account_id/);
  });

  it('revokes table rights from anon when the role exists', async () => {
    const pg = new PGlite({ extensions: { citext } });
    try {
      await pg.query(`CREATE ROLE anon`);
      await pg.query(`CREATE ROLE authenticated`);

      const files = readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith('.sql'))
        .sort();
      let granted = false;
      for (const file of files) {
        if (file === '0068_security_and_webhook_fk_index.sql') {
          await pg.query(`GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated`);

          // POSITIVE CONTROL. `has_table_privilege` is false for a role
          // that was never granted anything, so asserting false AFTER the
          // revoke proves nothing on its own -- deleting the GRANT above
          // left this whole spec green. Asserting the grant landed first
          // is what makes the assertion below mean "revoked" rather than
          // "never granted".
          const before = await pg.query<{ ok: boolean }>(
            `SELECT has_table_privilege('anon', 'public.senders', 'SELECT') AS ok`,
          );
          expect(before.rows[0]?.ok).toBe(true);

          // Default privileges must actually GRANT before 0068 can be
          // shown to revoke them. Without this the "future table" check
          // below is vacuous: a fresh table never had anon privileges in
          // the first place, so it reads false whether or not the
          // migration's ALTER DEFAULT PRIVILEGES ran. Verified by
          // neutering that statement -- the check passed until this line
          // existed, and fails without it.
          await pg.query(
            `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated`,
          );
          granted = true;
        }
        await applySql(pg, readSql(file));
      }
      expect(granted, 'migration 0068 was never reached -- was it renamed?').toBe(true);

      const tableRevoked = await pg.query<{ ok: boolean }>(
        `SELECT has_table_privilege('anon', 'public.senders', 'SELECT') AS ok`,
      );
      expect(tableRevoked.rows[0]?.ok).toBe(false);

      const otherRoleRevoked = await pg.query<{ ok: boolean }>(
        `SELECT has_table_privilege('authenticated', 'public.webhook_dedup', 'DELETE') AS ok`,
      );
      expect(otherRoleRevoked.rows[0]?.ok).toBe(false);

      // SEQUENCES had no coverage at all -- the assertion that looked like
      // it covered them called `has_table_privilege` on a table.
      const seqRevoked = await pg.query<{ ok: boolean }>(
        `SELECT COALESCE(bool_or(has_sequence_privilege('anon', c.oid, 'USAGE')), false) AS ok
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relkind = 'S' AND n.nspname = 'public'`,
      );
      expect(seqRevoked.rows[0]?.ok).toBe(false);

      // DEFAULT PRIVILEGES are the migration's actual long-term purpose --
      // stopping a FUTURE table from being re-granted. Nothing exercised
      // them: replacing both statements with `SELECT 1` kept every test
      // green. A table created after the replay is the only real check.
      await pg.query(`CREATE TABLE public.post_migration_probe (id int)`);
      const futureTable = await pg.query<{ ok: boolean }>(
        `SELECT has_table_privilege('anon', 'public.post_migration_probe', 'SELECT') AS ok`,
      );
      expect(futureTable.rows[0]?.ok).toBe(false);
    } finally {
      await pg.close();
    }
  });
});
