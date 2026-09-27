import { is } from 'drizzle-orm';
import { getTableConfig, IndexedColumn, PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import * as schema from '../src/schema/index.js';
import { freshTestPglite } from '../src/testing/index.js';

/**
 * Drizzle schema ↔ migrations parity.
 *
 * `src/schema/*.ts` mirrors what the migrations build (ADR-0001), and
 * nothing compared the two: drizzle-kit's journal stops at 0015, so
 * `drizzle-kit check` passes whatever a later schema declares, and the
 * round-trip test compares only table and enum names. By 2026-09-27 the
 * migrations had built seven indexes and two CHECK constraints the schema
 * never declared, each merged with review as its only check.
 *
 * Compared in both directions against a database built from the real
 * migration files: tables, CHECK constraints, and standalone indexes
 * (an index owned by a primary key or UNIQUE constraint belongs to that
 * constraint). An index also matches on uniqueness, key columns in order
 * (an expression key reads as `(expr)`), and whether it is partial.
 * Predicate and expression text are not compared: Postgres rewrites both
 * (`IN (…)` becomes `= ANY (ARRAY[…])`), so matching them would test a
 * normaliser, not the schema.
 */

interface Objects {
  tables: string[];
  checks: string[];
  indexes: string[];
}

function describeIndex(
  table: string,
  name: string,
  unique: boolean,
  columns: string[],
  partial: boolean,
): string {
  return `${table}.${name}${unique ? ' unique' : ''} (${columns.join(', ')})${partial ? ' partial' : ''}`;
}

function declaredObjects(): Objects {
  const out: Objects = { tables: [], checks: [], indexes: [] };
  const exported: unknown[] = Object.values(schema);
  for (const table of exported.filter((v): v is PgTable => is(v, PgTable))) {
    const config = getTableConfig(table);
    out.tables.push(config.name);
    for (const check of config.checks) out.checks.push(`${config.name}.${check.name}`);
    for (const index of config.indexes) {
      const columns = index.config.columns.map((c) =>
        is(c, IndexedColumn) ? (c.name ?? '(unnamed)') : '(expr)',
      );
      out.indexes.push(
        describeIndex(
          config.name,
          index.config.name ?? '(unnamed)',
          index.config.unique,
          columns,
          index.config.where !== undefined,
        ),
      );
    }
  }
  return { tables: out.tables.sort(), checks: out.checks.sort(), indexes: out.indexes.sort() };
}

async function builtObjects(): Promise<Objects> {
  const pg = await freshTestPglite();
  const tables = await pg.query<{ name: string }>(
    `SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public'`,
  );
  const checks = await pg.query<{ name: string }>(
    `SELECT c.relname || '.' || k.conname AS name
     FROM pg_constraint k
     JOIN pg_class c ON c.oid = k.conrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND k.contype = 'c'`,
  );
  const indexes = await pg.query<{
    table_name: string;
    index_name: string;
    is_unique: boolean;
    is_partial: boolean;
    columns: string[];
  }>(
    `SELECT c.relname AS table_name,
            i.relname AS index_name,
            x.indisunique AS is_unique,
            x.indpred IS NOT NULL AS is_partial,
            ARRAY(
              SELECT COALESCE(a.attname::text, '(expr)')
              FROM unnest(x.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
              LEFT JOIN pg_attribute a
                ON a.attrelid = x.indrelid AND a.attnum = k.attnum AND k.attnum > 0
              WHERE k.ord <= x.indnkeyatts
              ORDER BY k.ord
            ) AS columns
     FROM pg_index x
     JOIN pg_class i ON i.oid = x.indexrelid
     JOIN pg_class c ON c.oid = x.indrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       -- A foreign key's conindid names the index it references, not one
       -- it owns, so only p/u/x constraints claim an index.
       AND NOT EXISTS (
         SELECT 1 FROM pg_constraint k
         WHERE k.conindid = x.indexrelid AND k.contype IN ('p', 'u', 'x')
       )`,
  );
  await pg.close();
  return {
    tables: tables.rows.map((r) => r.name).sort(),
    checks: checks.rows.map((r) => r.name).sort(),
    indexes: indexes.rows
      .map((r) => describeIndex(r.table_name, r.index_name, r.is_unique, r.columns, r.is_partial))
      .sort(),
  };
}

describe('Drizzle schema ↔ migrations parity', () => {
  it('declares every table, CHECK constraint and index the migrations build, and nothing else', async () => {
    const declared = declaredObjects();
    const built = await builtObjects();

    // Two empty lists would compare equal; a parity check that saw
    // nothing on both sides must fail, not pass.
    for (const objects of [declared, built]) {
      expect(objects.tables).not.toHaveLength(0);
      expect(objects.checks).not.toHaveLength(0);
      expect(objects.indexes).not.toHaveLength(0);
    }
    expect(declared.tables).toEqual(built.tables);
    expect(declared.checks).toEqual(built.checks);
    expect(declared.indexes).toEqual(built.indexes);
  });
});
