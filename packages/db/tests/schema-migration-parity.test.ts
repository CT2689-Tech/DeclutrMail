import type { PGlite } from '@electric-sql/pglite';
import { is, SQL } from 'drizzle-orm';
import { getTableConfig, IndexedColumn, PgDialect, PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import * as schema from '../src/schema/index.js';
import { freshTestPglite } from '../src/testing/index.js';

/**
 * Drizzle schema ↔ migrations parity.
 *
 * `src/schema/*.ts` mirrors what the migrations build (ADR-0001), and
 * nothing compared the two: drizzle-kit's journal stops at 0015, so
 * `drizzle-kit check` passes whatever a later schema declares, and the
 * round-trip test compares only table and enum names. By 2026-09-27,
 * merged migrations had built six indexes and two CHECK constraints the
 * schema never declared, with review as their only check.
 *
 * Compared in both directions against a database built from the real
 * migration files: tables, CHECK constraints, and standalone indexes (an
 * index owned by a primary key or UNIQUE constraint belongs to that
 * constraint). An index matches on uniqueness, method, key columns and
 * expressions in order with their sort direction, and its predicate.
 *
 * Postgres rewrites a predicate or expression when it stores one (`IN (…)`
 * becomes `= ANY (ARRAY[…])`), so text written two ways cannot be compared
 * directly. Each declaration is built as a probe on the same database and
 * both sides are read back through Postgres (`pg_get_indexdef`,
 * `pg_get_expr`): Postgres is the normaliser. NULLS ordering and operator
 * classes are not compared — Drizzle's `.desc()` records NULLS LAST, which
 * a hand-written DESC does not mean.
 */

const PROBE = 'parity_probe';
const dialect = new PgDialect();

/** Unqualified SQL for a declaration's expression, as DDL would take it. */
function render(value: SQL): string {
  const query = dialect.sqlToQuery(value, 'indexes');
  // DDL takes no bind parameters, so a declaration built from an
  // interpolated JS value cannot be the text a migration ran.
  expect(query.params).toEqual([]);
  return query.sql;
}

/** One index, described identically for both sides. */
function describeIndex(row: {
  table_name: string;
  index_name: string;
  is_unique: boolean;
  method: string;
  columns: string[];
  predicate: string | null;
}): string {
  return (
    `${row.table_name}.${row.index_name}${row.is_unique ? ' unique' : ''} ${row.method}` +
    ` (${row.columns.join(', ')})${row.predicate === null ? '' : ` WHERE ${row.predicate}`}`
  );
}

// Key columns and expressions as Postgres prints them, each with DESC when
// its sort direction is descending (bit 0 of `indoption`), plus the predicate.
const INDEX_SHAPE = `
  ARRAY(
    SELECT pg_get_indexdef(x.indexrelid, k.ord, true)
           || CASE WHEN x.indoption[k.ord - 1] & 1 = 1 THEN ' DESC' ELSE '' END
    FROM generate_series(1, x.indnkeyatts) AS k(ord)
    ORDER BY k.ord
  ) AS columns,
  pg_get_expr(x.indpred, x.indrelid, true) AS predicate`;

interface Objects {
  tables: string[];
  checks: string[];
  indexes: string[];
}

async function builtObjects(pg: PGlite): Promise<Objects> {
  const tables = await pg.query<{ name: string }>(
    `SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public'`,
  );
  const checks = await pg.query<{ name: string }>(
    `SELECT c.relname || '.' || k.conname || ' CHECK ' || pg_get_expr(k.conbin, k.conrelid, true) AS name
     FROM pg_constraint k
     JOIN pg_class c ON c.oid = k.conrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND k.contype = 'c'`,
  );
  const indexes = await pg.query<Parameters<typeof describeIndex>[0]>(
    `SELECT c.relname AS table_name, i.relname AS index_name,
            x.indisunique AS is_unique, am.amname AS method, ${INDEX_SHAPE}
     FROM pg_index x
     JOIN pg_class i ON i.oid = x.indexrelid
     JOIN pg_class c ON c.oid = x.indrelid
     JOIN pg_am am ON am.oid = i.relam
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       -- A foreign key's conindid names the index it references, not one
       -- it owns, so only p/u/x constraints claim an index.
       AND NOT EXISTS (
         SELECT 1 FROM pg_constraint k
         WHERE k.conindid = x.indexrelid AND k.contype IN ('p', 'u', 'x')
       )`,
  );
  return {
    tables: tables.rows.map((r) => r.name).sort(),
    checks: checks.rows.map((r) => r.name).sort(),
    indexes: indexes.rows.map(describeIndex).sort(),
  };
}

async function declaredObjects(pg: PGlite): Promise<Objects> {
  const out: Objects = { tables: [], checks: [], indexes: [] };
  const exported: unknown[] = Object.values(schema);
  for (const table of exported.filter((v): v is PgTable => is(v, PgTable))) {
    const config = getTableConfig(table);
    out.tables.push(config.name);

    for (const check of config.checks) {
      await pg.exec(
        `ALTER TABLE "${config.name}" ADD CONSTRAINT ${PROBE} CHECK (${render(check.value)})`,
      );
      const probe = await pg.query<{ expr: string }>(
        `SELECT pg_get_expr(conbin, conrelid, true) AS expr FROM pg_constraint
         WHERE conname = '${PROBE}' AND conrelid = '"${config.name}"'::regclass`,
      );
      await pg.exec(`ALTER TABLE "${config.name}" DROP CONSTRAINT ${PROBE}`);
      expect(probe.rows).toHaveLength(1);
      out.checks.push(`${config.name}.${check.name} CHECK ${probe.rows[0]!.expr}`);
    }

    for (const index of config.indexes) {
      const keys = index.config.columns.map((column) => {
        if (is(column, IndexedColumn)) {
          return `"${column.name}"${column.indexConfig.order === 'desc' ? ' DESC' : ''}`;
        }
        if (is(column, SQL)) return `(${render(column)})`;
        throw new Error(`${config.name}.${index.config.name}: unrecognised index key`);
      });
      const where = index.config.where ? ` WHERE ${render(index.config.where)}` : '';
      await pg.exec(
        `CREATE INDEX ${PROBE} ON "${config.name}" USING ${index.config.method ?? 'btree'} (${keys.join(', ')})${where}`,
      );
      const probe = await pg.query<{ columns: string[]; predicate: string | null }>(
        `SELECT ${INDEX_SHAPE} FROM pg_index x WHERE x.indexrelid = '${PROBE}'::regclass`,
      );
      await pg.exec(`DROP INDEX ${PROBE}`);
      expect(probe.rows).toHaveLength(1);
      out.indexes.push(
        describeIndex({
          table_name: config.name,
          index_name: index.config.name ?? '(unnamed)',
          is_unique: index.config.unique,
          method: index.config.method ?? 'btree',
          ...probe.rows[0]!,
        }),
      );
    }
  }
  return { tables: out.tables.sort(), checks: out.checks.sort(), indexes: out.indexes.sort() };
}

describe('Drizzle schema ↔ migrations parity', () => {
  it('declares every table, CHECK constraint and index the migrations build, and nothing else', async () => {
    const pg = await freshTestPglite();
    // Read what the migrations built before any probe touches the database.
    const built = await builtObjects(pg);
    const declared = await declaredObjects(pg);
    await pg.close();

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
