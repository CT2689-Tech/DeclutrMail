import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { lockSenderIndex } from './sender-index-lock.js';

/**
 * The lock is what makes `AutopilotApplyWorker`'s fingerprint re-check
 * and its INSERT atomic against an `InitialSyncWorker` rebuild. Two ways
 * it could be silently wrong — the session-scoped variant (never
 * released, eventually wedging the mailbox) or a key that differs
 * between the two call sites (no exclusion at all, and nothing fails) —
 * both look identical to a passing integration test, so pin the
 * rendered statement.
 */
describe('lockSenderIndex', () => {
  const render = async (mailboxAccountId: string) => {
    const dialect = new PgDialect();
    let rendered: { sql: string; params: unknown[] } | null = null;
    await lockSenderIndex(
      {
        execute: async (query) => {
          const q = dialect.sqlToQuery(query);
          rendered = { sql: q.sql, params: q.params };
        },
      },
      mailboxAccountId,
    );
    return rendered!;
  };

  it('takes the TRANSACTION-scoped lock, not the session-scoped one', async () => {
    const { sql } = await render('11111111-1111-4111-8111-111111111111');
    expect(sql).toContain('pg_advisory_xact_lock');
    // `pg_advisory_lock` outlives the transaction and has no unlock path
    // here — it would leak a held lock per sweep.
    expect(sql).not.toMatch(/pg_advisory_lock\b/);
    expect(sql).toContain('hashtext');
  });

  it('keys on the mailbox, passed as a parameter rather than interpolated', async () => {
    const id = '22222222-2222-4222-8222-222222222222';
    const { sql, params } = await render(id);
    expect(params).toContain(id);
    expect(sql).not.toContain(id);
  });

  it('derives the same key for the same mailbox and a different one otherwise', async () => {
    const a = await render('33333333-3333-4333-8333-333333333333');
    const b = await render('33333333-3333-4333-8333-333333333333');
    const c = await render('44444444-4444-4444-8444-444444444444');
    expect(a.params).toEqual(b.params);
    expect(a.params).not.toEqual(c.params);
    // Namespace is a constant, so the statement text never varies.
    expect(a.sql).toBe(c.sql);
  });
});
