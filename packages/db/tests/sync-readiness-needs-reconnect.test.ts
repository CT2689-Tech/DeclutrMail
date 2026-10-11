/**
 * Migrations 0087 and 0088 — `sync_readiness` gains `needs_reconnect`,
 * then existing failed reconnect-grant rows move onto it.
 *
 * The round-trip suite compares type names only. These run the shipped
 * files: the value is usable, the backfill moves only those error codes,
 * indexed history on the row is left in place, and 0087's rollback
 * refuses to drop the value while a row still holds it.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'migrations');

async function run(pg: PGlite, sqlText: string): Promise<void> {
  for (const stmt of sqlText.split('--> statement-breakpoint')) {
    const trimmed = stmt.trim();
    if (trimmed) await pg.exec(trimmed);
  }
}

async function applyThrough(pg: PGlite, lastInclusive: string): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && f <= lastInclusive)
    .sort();
  for (const file of files) {
    await run(pg, readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
}

async function seedMailbox(pg: PGlite, email: string): Promise<string> {
  const ws = await pg.query<{ id: string }>(
    `INSERT INTO workspaces (name) VALUES ('W') RETURNING id`,
  );
  const user = await pg.query<{ id: string }>(
    `INSERT INTO users (workspace_id, email) VALUES ($1, $2) RETURNING id`,
    [ws.rows[0]!.id, email],
  );
  const mb = await pg.query<{ id: string }>(
    `INSERT INTO mailbox_accounts (workspace_id, user_id, provider, provider_account_id)
     VALUES ($1, $2, 'gmail', $3) RETURNING id`,
    [ws.rows[0]!.id, user.rows[0]!.id, email],
  );
  return mb.rows[0]!.id;
}

describe('sync_readiness needs_reconnect', () => {
  it('adds the value, backfills only reconnect-class failures, and keeps the cursor', async () => {
    const pg = new PGlite({ extensions: { citext } });
    await applyThrough(pg, '0087_sync_readiness_needs_reconnect.sql');
    await pg.query(`SELECT 'needs_reconnect'::sync_readiness`);

    const grant = await seedMailbox(pg, 'grant@ex.com');
    const limited = await seedMailbox(pg, 'limited@ex.com');
    await pg.query(
      `INSERT INTO provider_sync_state (mailbox_account_id, readiness_status, error_code, last_history_id)
       VALUES ($1, 'failed', 'InvalidGrantError', 42), ($2, 'failed', 'RateLimitError', 7)`,
      [grant, limited],
    );

    await run(pg, readFileSync(join(MIGRATIONS_DIR, '0088_backfill_needs_reconnect.sql'), 'utf8'));

    const rows = await pg.query<{
      mailbox_account_id: string;
      readiness_status: string;
      error_code: string;
      last_history_id: string;
    }>(
      `SELECT mailbox_account_id, readiness_status, error_code, last_history_id::text
       FROM provider_sync_state ORDER BY error_code`,
    );
    expect(rows.rows).toEqual([
      {
        mailbox_account_id: grant,
        readiness_status: 'needs_reconnect',
        error_code: 'InvalidGrantError',
        last_history_id: '42',
      },
      {
        mailbox_account_id: limited,
        readiness_status: 'failed',
        error_code: 'RateLimitError',
        last_history_id: '7',
      },
    ]);

    await run(
      pg,
      readFileSync(join(MIGRATIONS_DIR, '0088_backfill_needs_reconnect.rollback'), 'utf8'),
    );
    const restored = await pg.query<{ readiness_status: string }>(
      `SELECT readiness_status FROM provider_sync_state WHERE mailbox_account_id = $1`,
      [grant],
    );
    expect(restored.rows[0]!.readiness_status).toBe('failed');
    await pg.close();
  });

  it('refuses to drop the enum value while a row still uses it', async () => {
    const pg = new PGlite({ extensions: { citext } });
    await applyThrough(pg, '0088_backfill_needs_reconnect.sql');
    const id = await seedMailbox(pg, 'still@ex.com');
    await pg.query(
      `INSERT INTO provider_sync_state (mailbox_account_id, readiness_status, error_code)
       VALUES ($1, 'needs_reconnect', 'InvalidGrantError')`,
      [id],
    );
    await expect(
      run(
        pg,
        readFileSync(join(MIGRATIONS_DIR, '0087_sync_readiness_needs_reconnect.rollback'), 'utf8'),
      ),
    ).rejects.toThrow();
    const still = await pg.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM provider_sync_state WHERE readiness_status = 'needs_reconnect'`,
    );
    expect(still.rows[0]!.n).toBe('1');
    await pg.close();
  });
});
