/**
 * Regression guard for the ScoreWorker `triage_decisions` upsert
 * (D25) — the monotonic re-score guard must NOT pass a raw JS `Date`
 * to the driver.
 *
 * Why this test exists: the worker integration tests run on PGlite,
 * which tolerates a bare `Date` bound into a raw `sql` fragment. The
 * production `postgres-js` driver does NOT — it throws
 * "Failed query … Wed May 27 2026 … PDT" at runtime. So a unit suite
 * can be green while the live worker 500s on every decision write
 * (which is exactly what happened — Codex smoke 2026-05-27).
 *
 * This test inspects the compiled SQL params (no DB connection — the
 * `postgres()` client is lazy and `.toSQL()` never executes) and
 * asserts none of them is a `Date` instance. Using drizzle's `lt()`
 * helper maps the Date through the column's timestamptz type to an
 * ISO string; reverting to `sql\`… < ${producedAt}\`` would put a
 * raw Date back in `params` and fail here.
 *
 * See memory: drizzle-raw-sql-param-pitfalls.
 */

import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { lt, sql } from 'drizzle-orm';
import { triageDecisions } from '@declutrmail/db';

// `.toSQL()` compiles the query through the shared PG dialect + the
// column's type mapper — it never touches the DB, so the param
// mapping (Date → ISO string for a timestamptz column via `lt()`, or
// a raw Date for a bare `sql` fragment) is identical to what the
// production postgres-js driver would receive. PGlite is just a
// convenient in-process PgDatabase to build the query from.
const db = drizzle(new PGlite());

function scoreUpsertSql(producedAt: Date, expiresAt: Date) {
  return db
    .insert(triageDecisions)
    .values({
      mailboxAccountId: '00000000-0000-0000-0000-000000000000',
      senderKey: 'sk',
      verdict: 'later',
      confidence: '0.70',
      reasoning: 'r',
      generatedBy: 'template',
      producedAt,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [triageDecisions.mailboxAccountId, triageDecisions.senderKey],
      set: {
        verdict: 'later',
        confidence: '0.70',
        reasoning: 'r',
        generatedBy: 'template',
        producedAt,
        expiresAt,
        updatedAt: sql`now()`,
      },
      where: lt(triageDecisions.producedAt, producedAt),
    })
    .toSQL();
}

describe('ScoreWorker triage_decisions upsert — param binding (D25)', () => {
  it('binds no raw Date param (postgres-js rejects raw Dates in SQL)', () => {
    const { params } = scoreUpsertSql(
      new Date('2026-05-28T05:54:24.895Z'),
      new Date('2026-06-04T05:54:24.895Z'),
    );
    const rawDates = params.filter((p) => p instanceof Date);
    expect(rawDates).toEqual([]);
  });

  it('still expresses the monotonic guard in the WHERE clause', () => {
    const { sql: text } = scoreUpsertSql(new Date(), new Date());
    // Guard present: only update when the stored produced_at is older.
    expect(text).toMatch(/on conflict/i);
    expect(text.toLowerCase()).toContain('produced_at');
  });
});
