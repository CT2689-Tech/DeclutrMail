import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';

import { mailMessages } from '../src/schema/mail-messages.js';
import { NON_MAIL_LABELS, nonMailRowWhere } from '../src/predicates.js';
import { freshTestPglite } from '../src/testing/index.js';

/**
 * Migration 0080 — partial index over non-mail rows (drafts, chat lines).
 *
 * The non-mail purge probes and deletes through this index in the nightly
 * sender index sweep. Its value is entirely in the predicate: the index
 * holds only non-mail rows, so on a clean mailbox the probe reads an empty
 * index instead of every message. A predicate that drifts from
 * `nonMailRowWhere()` still builds, still exists, and silently stops
 * being chosen — so pin the label set, and prove the planner picks it.
 * The purge's own DELETE is plan-checked in `non-mail-purge.test.ts`.
 */

const INDEX = 'mail_messages_non_mail_idx';

async function indexDef(pg: Awaited<ReturnType<typeof freshTestPglite>>): Promise<string> {
  const res = await pg.query<{ indexdef: string }>(
    `SELECT indexdef FROM pg_indexes WHERE tablename = 'mail_messages' AND indexname = $1`,
    [INDEX],
  );
  expect(res.rows).toHaveLength(1);
  return res.rows[0]!.indexdef.replace(/\s+/g, ' ');
}

describe('migration 0080 — non-mail partial index', () => {
  it('indexes exactly the NON_MAIL_LABELS rows, by mailbox and date', async () => {
    const def = await indexDef(await freshTestPglite());

    // `internal_date` in the key serves the purge's newest-first batches.
    expect(def).toMatch(/\(mailbox_account_id, internal_date\) WHERE/);
    const labels = [...def.matchAll(/'([A-Z_]+)'::text/g)].map((m) => m[1]);
    expect(labels.sort()).toEqual([...NON_MAIL_LABELS].sort());
    expect(def).toMatch(/label_ids && /);
  });

  it('answers a nonMailRowWhere() lookup for one mailbox — the purge’s probe and batch shape', async () => {
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
    // A mailbox of real mail with one draft in it — the shape every
    // purge after the first one sees, minus even the draft.
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

    const db = drizzle({ client: pg });
    const statement = db
      .select({ id: mailMessages.id })
      .from(mailMessages)
      .where(and(eq(mailMessages.mailboxAccountId, mailboxId), nonMailRowWhere()))
      .limit(1000)
      .toSQL();
    const plan = await pg.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN ${statement.sql}`,
      statement.params as unknown[],
    );
    const text = plan.rows.map((row) => row['QUERY PLAN']).join('\n');

    expect(text).toContain(INDEX);
  });
});
