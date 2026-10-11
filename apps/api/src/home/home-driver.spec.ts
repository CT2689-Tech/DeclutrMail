import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { mailboxAccounts, users, workspaces } from '@declutrmail/db';
import { createApiDatabase } from '../db/api-database.js';
import { UsersService } from '../users/users.service.js';
import { MailboxAccountsService } from '../mailboxes/mailbox-accounts.service.js';
import { SendersReadService } from '../senders/senders.read-service.js';

const fixture = process.env.HOME_VISIT_TEST_PG_URL;
if (fixture) {
  const url = new URL(fixture);
  if (
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    url.pathname !== '/declutrmail_e2e' ||
    url.search
  )
    throw new Error('Home fixture requires the isolated loopback declutrmail_e2e database.');
}
describe.skipIf(!fixture)('visit snapshots on real API adapters', () => {
  for (const driver of ['node-postgres', 'postgres-js'] as const) {
    for (const max of [1, 2]) {
      it(`${driver} pool ${max}: repeats and concurrent same-user visits use one transaction connection`, async () => {
        const connection = createApiDatabase({
          DATABASE_URL: fixture!,
          API_DB_DRIVER: driver,
          API_DB_POOL_MAX: String(max),
        });
        const db = connection.db;
        const [workspace] = await db
          .insert(workspaces)
          .values({ name: 'Synthetic visit adapter' })
          .returning();
        const [user] = await db
          .insert(users)
          .values({ email: `visit-${randomUUID()}@example.test`, workspaceId: workspace!.id })
          .returning();
        try {
          const service = new UsersService(db);
          const reads = new SendersReadService(db);
          const [account] = await db
            .insert(mailboxAccounts)
            .values({
              workspaceId: workspace!.id,
              userId: user!.id,
              provider: 'gmail',
              providerAccountId: user!.email,
            })
            .returning();
          const mailbox = account!.id;
          const accounts = new MailboxAccountsService(db, null!, null!, null!);
          const eligible = (tx: Pick<typeof db, 'execute'>) =>
            accounts.assertVisitEligible(user!.id, mailbox, tx);
          const read = (
            since: Date,
            until: Date,
            tx: Parameters<Parameters<typeof service.recordMailboxVisit>[3]>[2],
          ) => reads.indexedArrivals(mailbox, since, until, tx);
          const first = await service.recordMailboxVisit(
            user!.id,
            mailbox,
            randomUUID(),
            read,
            eligible,
          );
          expect(first.since).toBeNull();
          const visitId = randomUUID();
          const [a, b] = await Promise.all([
            service.recordMailboxVisit(user!.id, mailbox, visitId, read, eligible),
            service.recordMailboxVisit(user!.id, mailbox, visitId, read, eligible),
          ]);
          expect(a).toEqual(b);
          expect(a).toMatchObject({ since: first.until, indexedEmails: 0, indexedSenders: 0 });
        } finally {
          await db.delete(mailboxAccounts).where(eq(mailboxAccounts.userId, user!.id));
          await db.delete(users).where(eq(users.id, user!.id));
          await db.delete(workspaces).where(eq(workspaces.id, workspace!.id));
          await connection.close();
        }
      });
    }
  }
});
