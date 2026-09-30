import { and, count, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';

import { screenerAwaitingWhere } from '../src/predicates.js';
import { screenerQuarantine } from '../src/schema/screener-quarantine.js';
import { senders } from '../src/schema/senders.js';
import { freshTestPglite } from '../src/testing/index.js';

/**
 * `screenerAwaitingWhere` — THE rule for "waiting in the Screener", shared
 * by the Screener's list and badge (API) and the weekly receipt (worker).
 *
 * It has to hold under ANY join to `senders`. Under a LEFT join an entry
 * whose sender is gone reads `total_received` as NULL, and
 * `NOT (young AND NULL < 3)` is TRUE — so a rule that trusted the
 * caller's join would count young orphans, the exact over-count the
 * receipt shipped with.
 */
describe('screenerAwaitingWhere', () => {
  it('counts only entries the Screener shows, under an INNER or a LEFT join', async () => {
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
    const sender = (key: string) =>
      pg.query(
        `INSERT INTO senders (mailbox_account_id, sender_key, email, domain, gmail_category,
                              first_seen_at, last_seen_at, total_received)
         VALUES ($1, $2, $2 || '@x.test', 'x.test', 'promotions', now(), now(), 1)`,
        [mailboxId, key],
      );
    const entry = (key: string, ageDays: number, decided = false) =>
      pg.query(
        `INSERT INTO screener_quarantine (mailbox_account_id, sender_key, created_at, decided_at)
         VALUES ($1, $2, now() - ($3 || ' days')::interval, ${decided ? 'now()' : 'NULL'})`,
        [mailboxId, key, String(ageDays)],
      );
    await sender('shown');
    await entry('shown', 1);
    await entry('orphan-young', 1); // sender gone
    await entry('orphan-old', 40); // sender gone
    await sender('aged-out');
    await entry('aged-out', 40); // one message, past the age-out
    await sender('decided');
    await entry('decided', 1, true);

    const db = drizzle({ client: pg });
    const on = and(
      eq(senders.mailboxAccountId, screenerQuarantine.mailboxAccountId),
      eq(senders.senderKey, screenerQuarantine.senderKey),
    );
    const scope = and(eq(screenerQuarantine.mailboxAccountId, mailboxId), screenerAwaitingWhere());
    const [inner] = await db
      .select({ n: count() })
      .from(screenerQuarantine)
      .innerJoin(senders, on)
      .where(scope);
    const [left] = await db
      .select({ n: count() })
      .from(screenerQuarantine)
      .leftJoin(senders, on)
      .where(scope);

    expect(Number(inner!.n)).toBe(1);
    expect(Number(left!.n)).toBe(1);
  });
});
