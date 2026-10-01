import { freshTestPglite } from '@declutrmail/db/testing';
import { schema } from '@declutrmail/db';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';
import { SendersReadService } from './senders.read-service.js';

// Synthetic only: no production connection or mailbox contents.
describe('current-mail query plans', () => {
  it('serves list, counts and summary from the current-mail index', async () => {
    const pg = await freshTestPglite();
    const workspace = '00000000-0000-4000-8000-000000000001';
    const user = '00000000-0000-4000-8000-000000000002';
    const mailbox = '00000000-0000-4000-8000-000000000003';
    await pg.exec(`INSERT INTO workspaces(id,name) VALUES ('${workspace}','Synthetic');
      INSERT INTO users(id,workspace_id,email) VALUES ('${user}','${workspace}','synthetic@example.test');
      INSERT INTO mailbox_accounts(id,workspace_id,user_id,provider,provider_account_id)
      VALUES ('${mailbox}','${workspace}','${user}','gmail','synthetic@example.test');
      INSERT INTO senders(mailbox_account_id,sender_key,email,domain,first_seen_at,last_seen_at,total_received,gmail_category)
      SELECT '${mailbox}',md5(i::text),'sender'||i||'@example.test','example.test',now()-interval '80 days',now(),80,'updates'
      FROM generate_series(1,500) i;
      INSERT INTO mail_messages(mailbox_account_id,sender_key,provider_message_id,provider_thread_id,internal_date,label_ids,is_unread)
      SELECT '${mailbox}',md5(i::text),i||'-'||j,i||'-'||j,now()-j*interval '1 day',
        CASE WHEN i%10=0 AND j=80 THEN ARRAY[]::text[] ELSE ARRAY['TRASH'] END,false
      FROM generate_series(1,500) i CROSS JOIN generate_series(1,80) j;
      ANALYZE senders; ANALYZE mail_messages;`);
    const captured: Array<{ query: string; params: unknown[] }> = [];
    const db = drizzle(pg, {
      schema,
      logger: {
        logQuery(query, params) {
          captured.push({ query, params });
        },
      },
    });
    const service = new SendersReadService(db as never);
    const args = { mailboxAccountId: mailbox, category: null, currentMailOnly: true };
    expect(await service.listSenders({ ...args, cursor: null, limit: 50 })).toHaveLength(50);
    const meta = await service.getSenderListQueryMeta(args);
    expect(meta.totalMatching).toBe(50);
    expect(meta.filterCounts?.total).toBe(50);
    expect(
      (await service.getSenderSummary({ mailboxAccountId: mailbox })).cleanupActiveSenders,
    ).toBe(50);
    const currentMailQueries = captured.filter(({ query }) =>
      query.includes("ARRAY['TRASH', 'SPAM', 'DRAFT', 'CHAT']"),
    );
    // All four statements must be observed: rows, matching count, axis counts, summary.
    expect(currentMailQueries).toHaveLength(4);
    for (const [statement, { query, params }] of currentMailQueries.entries()) {
      const times: number[] = [];
      let plan = '';
      for (let run = 0; run < 3; run++) {
        const result = await pg.query<{ 'QUERY PLAN': Array<{ 'Execution Time': number }> }>(
          'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + query,
          params,
        );
        times.push(result.rows[0]!['QUERY PLAN'][0]!['Execution Time']);
        plan = JSON.stringify(result.rows[0]!['QUERY PLAN']);
      }
      process.stdout.write(
        JSON.stringify({
          statement,
          medianMs: [...times].sort((a, b) => a - b)[1],
          maxMs: Math.max(...times),
        }) + '\n',
      );
      expect.soft(plan).toContain('mail_messages_account_sender_current_idx');
    }
  }, 60_000);
});
