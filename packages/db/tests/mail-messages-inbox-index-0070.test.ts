import { describe, expect, it } from 'vitest';

import { freshTestPglite } from '../src/testing/index.js';

/**
 * Migration 0070 — partial index for the unbounded INBOX counts.
 *
 * `senders.read-service.ts` builds `inboxCount` / `unreadInboxCount` as
 * correlated subqueries with no date bound. Measured on production
 * 2026-08-22, `inboxCount` alone was 21,334 of the Senders query's
 * 42,666 buffers — half the total for one of twelve subqueries — with
 * `Rows Removed by Filter: 401` against `actual rows=170`.
 *
 * This index carries that exact predicate so the planner proves the
 * implication and drops the filter, and keeps `is_unread` in the KEY so
 * the unread variant is answered from the same scan.
 *
 * THE PREDICATE IS THE WHOLE POINT. An index on the same columns with a
 * different (or absent) predicate would still exist, still be used for
 * something, and silently give none of the benefit — so assert the
 * predicate text, not just the index name.
 *
 * `is_outbound = false` in the predicate is a SAFETY clause, not an
 * optimisation: a self-sent message carries both SENT and INBOX, and
 * including it would inflate the count the Senders row shows and the
 * D245 protection review ranks on. That is the 2026-07-26 action-surface
 * class. The predicate must keep excluding outbound mail.
 */

const INDEX = 'mail_messages_account_sender_inbox_idx';

describe('migration 0070 — INBOX partial index', () => {
  it('ships the index on (mailbox_account_id, sender_key, is_unread)', async () => {
    const pg = await freshTestPglite();
    const res = await pg.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE tablename = 'mail_messages' AND indexname = $1`,
      [INDEX],
    );

    expect(res.rows).toHaveLength(1);
    const def = res.rows[0]?.indexdef ?? '';
    expect(def).toMatch(/mailbox_account_id/);
    expect(def).toMatch(/sender_key/);
    expect(def).toMatch(/is_unread/);
  });

  it('carries the exact INBOX + inbound predicate, or it buys nothing', async () => {
    const pg = await freshTestPglite();
    const res = await pg.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE tablename = 'mail_messages' AND indexname = $1`,
      [INDEX],
    );

    const def = (res.rows[0]?.indexdef ?? '').replace(/\s+/g, ' ');

    // A partial index, not a plain one — without WHERE it covers the
    // whole table and the planner cannot drop the filter.
    expect(def).toMatch(/WHERE/i);
    // Inbound only. Dropping this would count self-sent SENT+INBOX mail.
    expect(def).toMatch(/is_outbound = false/i);
    // The INBOX membership test, in the ScalarArrayOpExpr form the query
    // uses — a containment rewrite here would stop matching it.
    expect(def).toMatch(/'INBOX'::text = ANY \(label_ids\)/i);
  });
});
