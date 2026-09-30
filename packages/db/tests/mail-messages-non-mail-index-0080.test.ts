import { describe, expect, it } from 'vitest';

import { freshTestPglite } from '../src/testing/index.js';

/**
 * Migration 0080 — partial index over non-mail rows (drafts, chat lines).
 *
 * The non-mail purge (PR #791) probes and deletes through this index in
 * the nightly sender index sweep, newest first. Its value is entirely in
 * the predicate: the index holds only non-mail rows, so on a clean mailbox
 * the probe reads an empty index instead of every message. A predicate
 * that drifts from the purge's still builds, still exists, and silently
 * stops being chosen — so pin the definition, and prove the planner picks
 * it for the purge's shape of query.
 */

const INDEX = 'mail_messages_non_mail_idx';

describe('migration 0080 — non-mail partial index', () => {
  it('indexes exactly the DRAFT and CHAT rows, by mailbox and date', async () => {
    const pg = await freshTestPglite();
    const res = await pg.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'mail_messages' AND indexname = $1`,
      [INDEX],
    );
    expect(res.rows).toHaveLength(1);
    const def = res.rows[0]!.indexdef.replace(/\s+/g, ' ');

    // `internal_date` in the key serves the purge's newest-first batches.
    expect(def).toMatch(/\(mailbox_account_id, internal_date\) WHERE/);
    // In this order: the planner uses the index only for a query that
    // repeats the same array literal, element order included.
    const labels = [...def.matchAll(/'([A-Z_]+)'::text/g)].map((m) => m[1]);
    expect(labels).toEqual(['DRAFT', 'CHAT']);
    expect(def).toMatch(/label_ids && /);
  });

  it('answers the purge’s newest-first lookup for one mailbox', async () => {
    const pg = await freshTestPglite();
    const ws = await pg.query<{ id: string }>(
      `INSERT INTO workspaces (name) VALUES ('ws') RETURNING id`,
    );
    const user = await pg.query<{ id: string }>(
      `INSERT INTO users (workspace_id, email) VALUES ($1, 'o@x.test') RETURNING id`,
      [ws.rows[0]!.id],
    );
    const mb = await pg.query<{ id: string }>(
      `INSERT INTO mailbox_accounts (workspace_id, user_id, provider, provider_account_id)
       VALUES ($1, $2, 'gmail', 'o@x.test') RETURNING id`,
      [ws.rows[0]!.id, user.rows[0]!.id],
    );
    const mailboxId = mb.rows[0]!.id;
    // A mailbox of real mail with one draft in it.
    await pg.query(
      `INSERT INTO mail_messages
         (mailbox_account_id, provider_message_id, provider_thread_id, sender_key,
          internal_date, label_ids, is_unread)
       SELECT $1, 'm-' || g, 't-' || g, 'k' || (g % 50), now(), ARRAY['INBOX'], false
       FROM generate_series(1, 5000) AS g`,
      [mailboxId],
    );
    await pg.query(
      `INSERT INTO mail_messages
         (mailbox_account_id, provider_message_id, provider_thread_id, sender_key,
          internal_date, label_ids, is_unread)
       VALUES ($1, 'draft-1', 't-d', 'k0', now(), ARRAY['DRAFT'], false)`,
      [mailboxId],
    );
    await pg.query('ANALYZE mail_messages');

    const plan = await pg.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN SELECT id FROM mail_messages
        WHERE mailbox_account_id = $1 AND label_ids && ARRAY['DRAFT','CHAT']::text[]
        ORDER BY internal_date DESC LIMIT 1000`,
      [mailboxId],
    );
    const text = plan.rows.map((row) => row['QUERY PLAN']).join('\n');

    expect(text).toContain(INDEX);
  });
});
