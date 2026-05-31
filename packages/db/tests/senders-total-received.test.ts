/**
 * Backfill correctness — `senders.total_received` (ADR-0014).
 *
 * Migration 0017 adds the column with a one-shot UPDATE that aggregates
 * `mail_messages` rows where `is_outbound = false` grouped by
 * `(mailbox_account_id, sender_key)`. The test extracts the UPDATE
 * statement from the migration file and runs it against PGlite with
 * seeded data so the SQL that ships is what's covered — drift between
 * test and migration becomes impossible.
 *
 * Cross-mailbox `sender_key` collision is the canary regression for
 * tenant isolation: the migration MUST scope the aggregation to a
 * mailbox; a bug there silently leaks counts across tenants (the same
 * shape MISTAKES.md 2026-05-23 caught for correlated subqueries).
 */

import { createHash, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { beforeEach, describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'migrations');

async function freshDbWithAllMigrations(): Promise<PGlite> {
  const pg = new PGlite({ extensions: { citext } });
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sqlText = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of sqlText.split('--> statement-breakpoint')) {
      const trimmed = stmt.trim();
      if (trimmed) await pg.query(trimmed);
    }
  }
  return pg;
}

/** D12 / ADR-0011 — `sha256("v1|" + lower(email))`, hex. */
function senderKeyFor(email: string): string {
  return createHash('sha256').update(`v1|${email.toLowerCase()}`).digest('hex');
}

async function seedMailbox(pg: PGlite, label: string): Promise<string> {
  const ws = await pg.query<{ id: string }>(
    `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
    [`WS-${label}`],
  );
  const wsId = ws.rows[0]!.id;
  const u = await pg.query<{ id: string }>(
    `INSERT INTO users (workspace_id, email) VALUES ($1, $2) RETURNING id`,
    [wsId, `${label}@declutrmail.ai`],
  );
  const userId = u.rows[0]!.id;
  const m = await pg.query<{ id: string }>(
    `INSERT INTO mailbox_accounts (workspace_id, user_id, provider, provider_account_id)
     VALUES ($1, $2, 'gmail', $3) RETURNING id`,
    [wsId, userId, `${label}@declutrmail.ai`],
  );
  return m.rows[0]!.id;
}

async function seedSender(pg: PGlite, mailboxId: string, email: string): Promise<string> {
  const key = senderKeyFor(email);
  await pg.query(
    `INSERT INTO senders (mailbox_account_id, sender_key, display_name, email, domain, gmail_category, first_seen_at, last_seen_at)
     VALUES ($1, $2, '', $3, $4, 'updates', now(), now())`,
    [mailboxId, key, email, email.split('@')[1] ?? ''],
  );
  return key;
}

async function seedMessage(
  pg: PGlite,
  args: { mailboxId: string; senderKey: string; isOutbound: boolean },
): Promise<void> {
  const pmid = `pmid-${randomUUID()}`;
  await pg.query(
    `INSERT INTO mail_messages
       (mailbox_account_id, provider_message_id, provider_thread_id, sender_key,
        subject, snippet, internal_date, is_unread, is_outbound)
     VALUES ($1, $2, $3, $4, '', '', now(), false, $5)`,
    [args.mailboxId, pmid, `thr-${pmid}`, args.senderKey, args.isOutbound],
  );
}

/**
 * Lift the backfill UPDATE out of the migration file so the test
 * exercises the SAME SQL that ships. A drift between the migration
 * and the test would otherwise pass silently — the canonical
 * "migration tests the migration" pattern.
 */
function backfillSql(): string {
  const file = readFileSync(join(MIGRATIONS_DIR, '0017_senders_total_received.sql'), 'utf8');
  for (const stmt of file.split('--> statement-breakpoint')) {
    const trimmed = stmt
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .trim();
    if (trimmed.startsWith('UPDATE')) return trimmed;
  }
  throw new Error('migration 0017 missing backfill UPDATE');
}

describe('senders.total_received backfill (ADR-0014)', () => {
  let pg: PGlite;

  beforeEach(async () => {
    pg = await freshDbWithAllMigrations();
  });

  it('counts inbound messages per (mailbox, sender_key) and excludes outbound', async () => {
    const mailbox = await seedMailbox(pg, 'a');
    const key = await seedSender(pg, mailbox, 'sender@x.com');
    await seedMessage(pg, { mailboxId: mailbox, senderKey: key, isOutbound: false });
    await seedMessage(pg, { mailboxId: mailbox, senderKey: key, isOutbound: false });
    // Outbound (SENT) must NOT contribute — the user's own replies are
    // not "received from" this sender.
    await seedMessage(pg, { mailboxId: mailbox, senderKey: key, isOutbound: true });

    await pg.query(backfillSql());

    const r = await pg.query<{ total_received: string | number }>(
      `SELECT total_received FROM senders WHERE sender_key = $1`,
      [key],
    );
    expect(Number(r.rows[0]!.total_received)).toBe(2);
  });

  it('isolates counters across mailboxes that share a sender_key', async () => {
    // Tenant-boundary regression. `sender_key` is deterministic from
    // email, so two distinct mailboxes that both receive mail from
    // `shared@x.com` carry IDENTICAL keys. The backfill MUST scope by
    // mailbox; if it does not, both senders' counts equal the sum.
    const mboxA = await seedMailbox(pg, 'a');
    const mboxB = await seedMailbox(pg, 'b');
    const key = await seedSender(pg, mboxA, 'shared@x.com');
    await seedSender(pg, mboxB, 'shared@x.com');
    await seedMessage(pg, { mailboxId: mboxA, senderKey: key, isOutbound: false });
    await seedMessage(pg, { mailboxId: mboxA, senderKey: key, isOutbound: false });
    await seedMessage(pg, { mailboxId: mboxA, senderKey: key, isOutbound: false });
    await seedMessage(pg, { mailboxId: mboxB, senderKey: key, isOutbound: false });

    await pg.query(backfillSql());

    const a = await pg.query<{ total_received: string | number }>(
      `SELECT total_received FROM senders WHERE mailbox_account_id = $1`,
      [mboxA],
    );
    const b = await pg.query<{ total_received: string | number }>(
      `SELECT total_received FROM senders WHERE mailbox_account_id = $1`,
      [mboxB],
    );
    expect(Number(a.rows[0]!.total_received)).toBe(3);
    expect(Number(b.rows[0]!.total_received)).toBe(1);
  });

  it('leaves senders with no messages at the default 0', async () => {
    const mailbox = await seedMailbox(pg, 'a');
    await seedSender(pg, mailbox, 'quiet@x.com');

    await pg.query(backfillSql());

    const r = await pg.query<{ total_received: string | number }>(
      `SELECT total_received FROM senders`,
    );
    expect(Number(r.rows[0]!.total_received)).toBe(0);
  });

  it('is idempotent — re-running the backfill yields the same counts', async () => {
    const mailbox = await seedMailbox(pg, 'a');
    const key = await seedSender(pg, mailbox, 'noisy@x.com');
    for (let i = 0; i < 4; i++) {
      await seedMessage(pg, { mailboxId: mailbox, senderKey: key, isOutbound: false });
    }

    await pg.query(backfillSql());
    await pg.query(backfillSql());

    const r = await pg.query<{ total_received: string | number }>(
      `SELECT total_received FROM senders WHERE sender_key = $1`,
      [key],
    );
    expect(Number(r.rows[0]!.total_received)).toBe(4);
  });
});
