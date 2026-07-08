import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';

import { mailboxAccounts, mailMessages, schema, senders, users, workspaces } from '../src';

/**
 * Constraints-tightening pack integration test (migration 0032,
 * FOUNDER-FOLLOWUPS 2026-05-22 ×2).
 *
 * Verifies the four CHECKs the migration promotes from worker-parser
 * contract to DB-level invariant:
 *
 *   1. `mail_messages.unsubscribe_url` — NULL or `https://…`
 *   2. `mail_messages.unsubscribe_mailto_url` — NULL or `mailto:…`
 *   3. `mail_messages.recipient_emails` — NULL unless `is_outbound`
 *      (ADR-0004: inbound recipients are never stored — D7 posture)
 *   4. `senders.unsubscribe_method` × `unsubscribe_url` scheme
 *      alignment (`deriveUnsubscribe` invariant: one_click ⇒ https://,
 *      mailto ⇒ mailto:, none/NULL ⇒ NULL)
 */

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'migrations');

async function freshDb() {
  const pg = new PGlite({ extensions: { citext } });
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of sql.split('--> statement-breakpoint')) {
      const trimmed = stmt.trim();
      if (trimmed) {
        await pg.query(trimmed);
      }
    }
  }
  return drizzle(pg, { schema });
}

async function seedMailbox(db: Awaited<ReturnType<typeof freshDb>>): Promise<string> {
  const [ws] = await db.insert(workspaces).values({ name: 'WS' }).returning({
    id: workspaces.id,
  });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: ws!.id, email: 'a@b.com' })
    .returning({ id: users.id });
  const [mb] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId: ws!.id,
      userId: user!.id,
      provider: 'gmail',
      providerAccountId: 'a@b.com',
    })
    .returning({ id: mailboxAccounts.id });
  return mb!.id;
}

function messageRow(mailboxAccountId: string, overrides: Record<string, unknown>) {
  return {
    mailboxAccountId,
    providerMessageId: `msg-${Math.random().toString(36).slice(2)}`,
    providerThreadId: 'thread-1',
    senderKey: 'c'.repeat(64),
    internalDate: new Date('2026-06-01'),
    isUnread: false,
    ...overrides,
  };
}

function senderRow(mailboxAccountId: string, overrides: Record<string, unknown>) {
  return {
    mailboxAccountId,
    senderKey: `${Math.random().toString(36).slice(2)}`.padEnd(64, 'd'),
    email: 'news@shop.example',
    domain: 'shop.example',
    gmailCategory: 'promotions' as const,
    firstSeenAt: new Date('2026-01-01'),
    lastSeenAt: new Date('2026-05-01'),
    ...overrides,
  };
}

describe('mail_messages unsubscribe URL scheme CHECKs (migration 0032)', () => {
  it('rejects a mailto: URL in the HTTPS column', async () => {
    const db = await freshDb();
    const mbId = await seedMailbox(db);
    await expect(
      db
        .insert(mailMessages)
        .values(messageRow(mbId, { unsubscribeUrl: 'mailto:unsub@shop.example' })),
    ).rejects.toThrow();
  });

  it('rejects a cleartext http:// URL in the HTTPS column (RFC 8058 §3)', async () => {
    const db = await freshDb();
    const mbId = await seedMailbox(db);
    await expect(
      db
        .insert(mailMessages)
        .values(messageRow(mbId, { unsubscribeUrl: 'http://shop.example/unsub' })),
    ).rejects.toThrow();
  });

  it('rejects an https:// URL in the mailto column', async () => {
    const db = await freshDb();
    const mbId = await seedMailbox(db);
    await expect(
      db
        .insert(mailMessages)
        .values(messageRow(mbId, { unsubscribeMailtoUrl: 'https://shop.example/unsub' })),
    ).rejects.toThrow();
  });

  it('accepts the aligned shapes (https in https column, mailto in mailto column, both NULL)', async () => {
    const db = await freshDb();
    const mbId = await seedMailbox(db);
    await db.insert(mailMessages).values(
      messageRow(mbId, {
        unsubscribeUrl: 'https://shop.example/unsub',
        unsubscribeMailtoUrl: 'mailto:unsub@shop.example',
      }),
    );
    await db.insert(mailMessages).values(messageRow(mbId, {}));
    const rows = await db.select().from(mailMessages);
    expect(rows).toHaveLength(2);
  });
});

describe('mail_messages recipient_emails outbound-only CHECK (migration 0032, ADR-0004)', () => {
  it('rejects recipient_emails on an INBOUND message', async () => {
    const db = await freshDb();
    const mbId = await seedMailbox(db);
    await expect(
      db
        .insert(mailMessages)
        .values(messageRow(mbId, { isOutbound: false, recipientEmails: ['x@y.com'] })),
    ).rejects.toThrow();
  });

  it('accepts recipient_emails on an OUTBOUND message and NULL on inbound', async () => {
    const db = await freshDb();
    const mbId = await seedMailbox(db);
    await db
      .insert(mailMessages)
      .values(messageRow(mbId, { isOutbound: true, recipientEmails: ['x@y.com'] }));
    await db.insert(mailMessages).values(messageRow(mbId, { isOutbound: false }));
    const rows = await db.select().from(mailMessages);
    expect(rows).toHaveLength(2);
  });
});

describe('senders unsubscribe method × URL alignment CHECK (migration 0032)', () => {
  it('rejects one_click with a mailto: URL', async () => {
    const db = await freshDb();
    const mbId = await seedMailbox(db);
    await expect(
      db.insert(senders).values(
        senderRow(mbId, {
          unsubscribeMethod: 'one_click',
          unsubscribeUrl: 'mailto:unsub@shop.example',
        }),
      ),
    ).rejects.toThrow();
  });

  it('rejects mailto method with an https:// URL', async () => {
    const db = await freshDb();
    const mbId = await seedMailbox(db);
    await expect(
      db.insert(senders).values(
        senderRow(mbId, {
          unsubscribeMethod: 'mailto',
          unsubscribeUrl: 'https://shop.example/unsub',
        }),
      ),
    ).rejects.toThrow();
  });

  it('rejects none/NULL method with a lingering URL', async () => {
    const db = await freshDb();
    const mbId = await seedMailbox(db);
    await expect(
      db.insert(senders).values(
        senderRow(mbId, {
          unsubscribeMethod: 'none',
          unsubscribeUrl: 'https://shop.example/unsub',
        }),
      ),
    ).rejects.toThrow();
    await expect(
      db.insert(senders).values(
        senderRow(mbId, {
          unsubscribeMethod: null,
          unsubscribeUrl: 'https://shop.example/unsub',
        }),
      ),
    ).rejects.toThrow();
  });

  it('accepts the four aligned shapes', async () => {
    const db = await freshDb();
    const mbId = await seedMailbox(db);
    await db.insert(senders).values([
      senderRow(mbId, {
        unsubscribeMethod: 'one_click',
        unsubscribeUrl: 'https://shop.example/unsub',
      }),
      senderRow(mbId, {
        unsubscribeMethod: 'mailto',
        unsubscribeUrl: 'mailto:unsub@shop.example',
      }),
      senderRow(mbId, { unsubscribeMethod: 'none', unsubscribeUrl: null }),
      senderRow(mbId, { unsubscribeMethod: null, unsubscribeUrl: null }),
    ]);
    const rows = await db.select().from(senders);
    expect(rows).toHaveLength(4);
  });
});
