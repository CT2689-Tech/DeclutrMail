import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { freshTestPglite } from '../src/testing/index.js';

it('backfills indexed arrival from retained inbound creation, preserves generation, and can roll back/reapply', async () => {
  const pg = await freshTestPglite();
  const migrations = join(import.meta.dirname, '..', 'migrations');
  const rollback = readFileSync(join(migrations, '0083_sender_first_indexed_at.rollback'), 'utf8');
  const forward = readFileSync(join(migrations, '0083_sender_first_indexed_at.sql'), 'utf8');
  await pg.exec(rollback);
  await pg.exec(`
    INSERT INTO workspaces(id,name) VALUES ('10000000-0000-4000-8000-000000000001','Migration fixture');
    INSERT INTO users(id,workspace_id,email) VALUES ('10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','migration@example.test');
    INSERT INTO mailbox_accounts(id,workspace_id,user_id,provider,provider_account_id) VALUES ('10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','gmail','migration@example.test');
    INSERT INTO senders(mailbox_account_id,sender_key,email,domain,gmail_category,first_seen_at,last_seen_at,created_at)
    VALUES ('10000000-0000-4000-8000-000000000003','retained','retained@example.test','example.test','unknown','2020-01-01T00:00:00Z','2020-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
           ('10000000-0000-4000-8000-000000000003','empty','empty@example.test','example.test','unknown','2020-01-01T00:00:00Z','2020-01-01T00:00:00Z','2024-01-01T00:00:00Z');
    INSERT INTO mail_messages(mailbox_account_id,provider_message_id,provider_thread_id,sender_key,internal_date,created_at,is_unread,is_outbound)
    VALUES ('10000000-0000-4000-8000-000000000003','in','in','retained','2020-01-01T00:00:00Z','2025-01-01T00:00:00Z',false,false),
           ('10000000-0000-4000-8000-000000000003','out','out','retained','2020-01-01T00:00:00Z','2021-01-01T00:00:00Z',false,true);
  `);
  for (let pass = 0; pass < 2; pass++) {
    await pg.exec(forward);
    const { rows } = await pg.query<{ sender_key: string; indexed: string; generation: string }>(
      `SELECT sender_key, first_indexed_at::text AS indexed, created_at::text AS generation FROM senders ORDER BY sender_key`,
    );
    expect(
      rows.map((row) => [
        row.sender_key,
        new Date(row.indexed).toISOString(),
        new Date(row.generation).toISOString(),
      ]),
    ).toEqual([
      ['empty', '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z'],
      ['retained', '2025-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'],
    ]);
    await pg.exec(rollback);
    const counts = await pg.query<{ n: number }>('SELECT count(*)::int AS n FROM mail_messages');
    expect(counts.rows[0]?.n).toBe(2);
  }
});
