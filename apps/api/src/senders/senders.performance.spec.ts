import { freshTestPglite } from '@declutrmail/db/testing';
import { schema } from '@declutrmail/db';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, it, expect } from 'vitest';
import { SendersReadService } from './senders.read-service.js';

// Opt-in synthetic query-plan benchmark. Never connects to a deployed database.
describe.skipIf(process.env.SENDER_SQL_BENCH !== '1')('sender query plans', () => {
  it('measures actual service queries with migrated indexes and synthetic mailbox sizes', async () => {
    const pg = await freshTestPglite();
    const ws = '00000000-0000-4000-8000-000000000001';
    const user = '00000000-0000-4000-8000-000000000002';
    const mailbox = '00000000-0000-4000-8000-000000000003';
    await pg.exec(`INSERT INTO workspaces(id,name) VALUES ('${ws}','Synthetic');
      INSERT INTO users(id,workspace_id,email) VALUES ('${user}','${ws}','synthetic@example.test');
      INSERT INTO mailbox_accounts(id,workspace_id,user_id,provider,provider_account_id)
      VALUES ('${mailbox}','${ws}','${user}','gmail','synthetic@example.test');`);
    let captured: { query: string; params: unknown[] } | undefined;
    const db = drizzle(pg, {
      schema,
      logger: {
        logQuery(query, params) {
          captured = { query, params };
        },
      },
    });
    const service = new SendersReadService(db as never);
    for (const size of [50, 2000]) {
      await pg.exec(`TRUNCATE senders, mail_messages, triage_decisions;
        INSERT INTO senders(mailbox_account_id,sender_key,email,domain,display_name,first_seen_at,last_seen_at,total_received,gmail_category)
        SELECT '${mailbox}',md5(i::text),'sender'||i||'@example.test','example.test','Sender '||i,
          now()-interval '365 days',now()-(i%90)*interval '1 day',100,'updates' FROM generate_series(1,${size}) i;
        INSERT INTO mail_messages(mailbox_account_id,sender_key,provider_message_id,provider_thread_id,internal_date,label_ids,is_unread)
        SELECT '${mailbox}',md5(i::text),i||'-'||j,i||'-'||j,now()-j*interval '2 days',
          CASE WHEN j%3=0 THEN ARRAY['INBOX'] ELSE ARRAY[]::text[] END,j%2=0
        FROM generate_series(1,${size}) i CROSS JOIN generate_series(1,100) j;
        INSERT INTO triage_decisions(mailbox_account_id,sender_key,verdict,confidence,reasoning,generated_by,expires_at)
        SELECT '${mailbox}',md5(i::text),'archive',0.9,'Synthetic','template',now()+interval '7 days'
        FROM generate_series(1,${size}) i WHERE i%2=0;
        ANALYZE senders; ANALYZE mail_messages; ANALYZE triage_decisions;`);
      for (const sort of ['total', 'name', 'first_seen', 'last_seen'] as const) {
        for (const q of [null, 'Sender 1999', 's', 'absent', '50%']) {
          const rows = await service.listSenders({
            mailboxAccountId: mailbox,
            limit: 50,
            cursor: null,
            category: null,
            sort,
            q,
          });
          expect(rows.length).toBeLessThanOrEqual(51);
          const query = captured!;
          const times: number[] = [];
          let plan: unknown;
          for (let run = 0; run < 3; run++) {
            const result = await pg.query<{
              'QUERY PLAN': Array<{ 'Execution Time': number; Plan: unknown }>;
            }>('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + query.query, query.params);
            times.push(result.rows[0]!['QUERY PLAN'][0]!['Execution Time']);
            plan = result.rows[0]!['QUERY PLAN'][0]!.Plan;
          }
          process.stdout.write(
            JSON.stringify({
              size,
              sort,
              q,
              medianMs: times.sort((a, b) => a - b)[1],
              messageScans: (JSON.stringify(plan).match(/"Relation Name":"mail_messages"/g) ?? [])
                .length,
              decisionScans: (
                JSON.stringify(plan).match(/"Relation Name":"triage_decisions"/g) ?? []
              ).length,
            }) + '\n',
          );
        }
      }
    }
  }, 120_000);
});
