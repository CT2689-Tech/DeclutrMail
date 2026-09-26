/**
 * Migration 0079 — `gmail_category` gains 'unknown'.
 *
 * The round-trip suite compares type NAMES only, so it cannot tell a
 * rollback that reverts 0079 from a no-op. These run the shipped files
 * and assert what matters: the value is usable after the forward, the
 * forward is re-runnable, and the rollback refuses to run while a sender
 * still holds 'unknown' (it must never silently turn one back into the
 * unverified 'primary').
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { beforeEach, describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'migrations');

async function run(pg: PGlite, sqlText: string): Promise<void> {
  for (const stmt of sqlText.split('--> statement-breakpoint')) {
    const trimmed = stmt.trim();
    if (trimmed) await pg.exec(trimmed);
  }
}

async function seedSender(pg: PGlite, category: string): Promise<void> {
  const ws = await pg.query<{ id: string }>(
    `INSERT INTO workspaces (name) VALUES ('W') RETURNING id`,
  );
  const user = await pg.query<{ id: string }>(
    `INSERT INTO users (workspace_id, email) VALUES ($1, 'o@ex.com') RETURNING id`,
    [ws.rows[0]!.id],
  );
  const mb = await pg.query<{ id: string }>(
    `INSERT INTO mailbox_accounts (workspace_id, user_id, provider, provider_account_id)
     VALUES ($1, $2, 'gmail', 'o@ex.com') RETURNING id`,
    [ws.rows[0]!.id, user.rows[0]!.id],
  );
  await pg.query(
    `INSERT INTO senders (mailbox_account_id, sender_key, email, domain, gmail_category, first_seen_at, last_seen_at)
     VALUES ($1, 'k', 's@ex.com', 'ex.com', $2::gmail_category, now(), now())`,
    [mb.rows[0]!.id, category],
  );
}

describe('migration 0079 — gmail_category unknown', () => {
  let pg: PGlite;
  const forward = readFileSync(join(MIGRATIONS_DIR, '0079_gmail_category_unknown.sql'), 'utf8');
  const rollback = readFileSync(
    join(MIGRATIONS_DIR, '0079_gmail_category_unknown.rollback'),
    'utf8',
  );

  beforeEach(async () => {
    pg = new PGlite({ extensions: { citext } });
    for (const file of readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort()) {
      await run(pg, readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
    }
  });

  it('appends unknown after the five labels, and re-running the forward is a no-op', async () => {
    await run(pg, forward);
    const { rows } = await pg.query<{ v: string }>(
      `SELECT unnest(enum_range(NULL::gmail_category))::text AS v`,
    );
    expect(rows.map((r) => r.v)).toEqual([
      'primary',
      'promotions',
      'social',
      'updates',
      'forums',
      'unknown',
    ]);
  });

  it('rolls back cleanly when no sender holds unknown', async () => {
    await seedSender(pg, 'promotions');
    await run(pg, rollback);
    const { rows } = await pg.query<{ v: string }>(
      `SELECT unnest(enum_range(NULL::gmail_category))::text AS v`,
    );
    expect(rows.map((r) => r.v)).not.toContain('unknown');
  });

  it('refuses to roll back while a sender still holds unknown', async () => {
    await seedSender(pg, 'unknown');
    await expect(run(pg, rollback)).rejects.toThrow();
    const { rows } = await pg.query<{ c: string }>(`SELECT gmail_category::text AS c FROM senders`);
    // Nothing was rewritten to the unverified default.
    expect(rows).toEqual([{ c: 'unknown' }]);
  });
});
