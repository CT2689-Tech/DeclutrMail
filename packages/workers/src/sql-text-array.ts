import { sql } from 'drizzle-orm';

/**
 * Bound `text[]` literal.
 *
 * Drizzle interpolating a JS `string[]` as `ANY(${keys})` expands to a
 * ROW `($1,$2)`, which Postgres rejects (triage.read-service.ts, Codex
 * smoke 2026-05-27). `sql.join` emits `ARRAY[$1, $2, …]::text[]`.
 *
 * An empty input yields `ARRAY[]::text[]`, which every `= ANY(...)`
 * predicate evaluates to false — a scope of "no keys" matches no rows
 * rather than degenerating to "all rows". Callers that mean "whole
 * mailbox" must pass no scope at all, not an empty array.
 */
export function sqlTextArray(values: readonly string[]) {
  if (values.length === 0) {
    return sql`ARRAY[]::text[]`;
  }
  return sql`ARRAY[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )}]::text[]`;
}
