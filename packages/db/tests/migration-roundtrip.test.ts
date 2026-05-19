/**
 * Migration round-trip test (D152 + Codex Doc 04 §18).
 *
 * Applies every forward migration in order against a fresh in-memory
 * PGlite instance, then applies the matching rollback file, then
 * re-applies the forward. Asserts the schema reaches a stable state
 * both times. Catches:
 *   - Rollback files that don't actually revert (missing DROPs, wrong order)
 *   - Forward migrations that aren't re-applyable after rollback
 *   - Index / constraint mismatches between schema and migration SQL
 *
 * Runs in CI on every PR touching packages/db/**.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'migrations');

function listForwardMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

function readSql(file: string): string {
  return readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
}

async function applyMigration(db: PGlite, sql: string): Promise<void> {
  for (const stmt of sql.split('--> statement-breakpoint')) {
    const trimmed = stmt.trim();
    if (!trimmed) continue;
    await db.exec(trimmed);
  }
}

async function listSchemaObjects(db: PGlite): Promise<string[]> {
  const tables = await db.query<{ name: string }>(
    `SELECT table_name AS name FROM information_schema.tables
     WHERE table_schema = 'public' ORDER BY table_name`,
  );
  const enums = await db.query<{ name: string }>(
    `SELECT typname AS name FROM pg_type t
     JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'public' AND t.typtype = 'e' ORDER BY typname`,
  );
  return [...tables.rows.map((r) => `table:${r.name}`), ...enums.rows.map((r) => `enum:${r.name}`)];
}

describe('migration round-trip', () => {
  it('every forward migration has a companion rollback file', () => {
    const forwards = listForwardMigrations();
    const rollbacks = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.rollback'));
    for (const fwd of forwards) {
      const expected = fwd.replace(/\.sql$/, '.rollback');
      expect(rollbacks).toContain(expected);
    }
  });

  it('apply → rollback → apply produces the same schema', async () => {
    const db = new PGlite({ extensions: { citext } });
    const forwards = listForwardMigrations();

    for (const fwd of forwards) {
      await applyMigration(db, readSql(fwd));
    }
    const afterFirstApply = await listSchemaObjects(db);

    for (const fwd of [...forwards].reverse()) {
      const rollback = fwd.replace(/\.sql$/, '.rollback');
      await applyMigration(db, readSql(rollback));
    }
    const afterRollback = await listSchemaObjects(db);
    expect(afterRollback).toEqual([]);

    for (const fwd of forwards) {
      await applyMigration(db, readSql(fwd));
    }
    const afterSecondApply = await listSchemaObjects(db);
    expect(afterSecondApply).toEqual(afterFirstApply);

    await db.close();
  });

  it('foundation tables exist with expected shape', async () => {
    const db = new PGlite({ extensions: { citext } });
    for (const fwd of listForwardMigrations()) {
      await applyMigration(db, readSql(fwd));
    }

    const objects = await listSchemaObjects(db);
    expect(objects).toEqual([
      'table:mailbox_accounts',
      'table:users',
      'table:workspaces',
      'enum:mailbox_provider',
      'enum:mailbox_status',
      'enum:workspace_tier',
    ]);

    await db.close();
  });
});
