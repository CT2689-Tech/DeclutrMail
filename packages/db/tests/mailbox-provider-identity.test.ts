import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { afterEach, describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'migrations');
const FORWARD = '0035_mailbox_provider_account_citext.sql';
const ROLLBACK = '0035_mailbox_provider_account_citext.rollback';

async function applySql(pg: PGlite, sql: string): Promise<void> {
  for (const statement of sql.split('--> statement-breakpoint')) {
    if (statement.trim()) await pg.exec(statement.trim());
  }
}

async function applyThrough0034(pg: PGlite): Promise<void> {
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql') && name < FORWARD)
    .sort()) {
    await applySql(pg, readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
}

async function seedMailbox(
  pg: PGlite,
  label: string,
  providerAccountId: string,
): Promise<{ mailboxId: string; workspaceId: string; userId: string }> {
  const workspace = await pg.query<{ id: string }>(
    `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
    [`${label} workspace`],
  );
  const workspaceId = workspace.rows[0]!.id;
  const user = await pg.query<{ id: string }>(
    `INSERT INTO users (workspace_id, email) VALUES ($1, $2) RETURNING id`,
    [workspaceId, `${label}@example.com`],
  );
  const userId = user.rows[0]!.id;
  const mailbox = await pg.query<{ id: string }>(
    `INSERT INTO mailbox_accounts (
       workspace_id, user_id, provider, provider_account_id,
       encrypted_refresh_token, dek_encrypted, key_version
     ) VALUES ($1, $2, 'gmail', $3, $4, $5, 1)
     RETURNING id`,
    [workspaceId, userId, providerAccountId, new Uint8Array([1]), new Uint8Array([2])],
  );
  return { mailboxId: mailbox.rows[0]!.id, workspaceId, userId };
}

describe('migration 0035 — canonical Gmail provider identity', () => {
  let pg: PGlite | undefined;

  afterEach(async () => {
    await pg?.close();
    pg = undefined;
  });

  it('normalizes existing values, keeps the unique index usable, and round-trips the type', async () => {
    pg = new PGlite({ extensions: { citext } });
    await applyThrough0034(pg);
    const owner = await seedMailbox(pg, 'canonical-owner', '  Mixed.Case@Example.COM  ');

    await applySql(pg, readFileSync(join(MIGRATIONS_DIR, FORWARD), 'utf8'));

    const column = await pg.query<{ udtName: string }>(
      `SELECT udt_name AS "udtName"
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'mailbox_accounts'
         AND column_name = 'provider_account_id'`,
    );
    expect(column.rows[0]?.udtName).toBe('citext');

    const canonical = await pg.query<{ providerAccountId: string }>(
      `SELECT provider_account_id AS "providerAccountId"
       FROM mailbox_accounts WHERE id = $1`,
      [owner.mailboxId],
    );
    expect(canonical.rows[0]?.providerAccountId).toBe('mixed.case@example.com');

    const upsert = await pg.query<{ id: string }>(
      `INSERT INTO mailbox_accounts (
         workspace_id, user_id, provider, provider_account_id, status
       ) VALUES ($1, $2, 'gmail', 'MIXED.CASE@EXAMPLE.COM', 'active')
       ON CONFLICT (provider, provider_account_id)
       DO UPDATE SET status = 'disconnected'
       RETURNING id`,
      [owner.workspaceId, owner.userId],
    );
    expect(upsert.rows[0]?.id).toBe(owner.mailboxId);
    const count = await pg.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM mailbox_accounts`,
    );
    expect(count.rows[0]?.count).toBe(1);

    await applySql(pg, readFileSync(join(MIGRATIONS_DIR, ROLLBACK), 'utf8'));
    const rolledBack = await pg.query<{ udtName: string }>(
      `SELECT udt_name AS "udtName"
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'mailbox_accounts'
         AND column_name = 'provider_account_id'`,
    );
    expect(rolledBack.rows[0]?.udtName).toBe('text');

    await applySql(pg, readFileSync(join(MIGRATIONS_DIR, FORWARD), 'utf8'));
    const reapplied = await pg.query<{ udtName: string }>(
      `SELECT udt_name AS "udtName"
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'mailbox_accounts'
         AND column_name = 'provider_account_id'`,
    );
    expect(reapplied.rows[0]?.udtName).toBe('citext');
  });

  it('aborts before mutation when canonical-equivalent rows have ambiguous ownership', async () => {
    pg = new PGlite({ extensions: { citext } });
    await applyThrough0034(pg);
    const first = await seedMailbox(pg, 'duplicate-owner-a', 'Same.Owner@Example.com');
    const second = await seedMailbox(pg, 'duplicate-owner-b', '  same.owner@EXAMPLE.COM  ');

    const before = await pg.query<{ row: unknown }>(
      `SELECT to_jsonb(mailbox_accounts) AS row
       FROM mailbox_accounts ORDER BY id`,
    );

    await expect(
      applySql(pg, readFileSync(join(MIGRATIONS_DIR, FORWARD), 'utf8')),
    ).rejects.toMatchObject({
      code: '23505',
      message: expect.stringContaining('0035 aborted'),
    });

    const after = await pg.query<{ row: unknown }>(
      `SELECT to_jsonb(mailbox_accounts) AS row
       FROM mailbox_accounts ORDER BY id`,
    );
    expect(after.rows).toEqual(before.rows);
    expect(after.rows).toHaveLength(2);
    expect(JSON.stringify(after.rows)).toContain(first.workspaceId);
    expect(JSON.stringify(after.rows)).toContain(second.workspaceId);
  });
});
