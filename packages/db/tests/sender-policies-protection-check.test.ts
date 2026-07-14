import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';

import {
  mailboxAccounts,
  protectionReason,
  schema,
  senderPolicies,
  users,
  workspaces,
} from '../src';

/**
 * sender_policies × protection_reason CHECK integration test
 * (migration 0023, schema/sender-policies.ts).
 *
 * Verifies the **one-way** invariant the migration encodes:
 *
 *     CHECK (NOT is_protected OR protection_reason IS NOT NULL)
 *
 * i.e. "if a row is protected, the reason must be recorded."
 *
 * The biconditional `is_protected = (reason IS NOT NULL)` is
 * intentionally NOT enforced — the **user-agency-wins memory pin**
 * (`automatic-protection.ts`, schema/senders.ts, MISTAKES.md
 * 2026-06-05 🔴-3) DELIBERATELY
 * leaves a manually-demoted automatically protected row with its
 * non-null reason as a memory pin so the
 * next sync skips re-protect. A biconditional CHECK would forbid that.
 *
 * Three cases asserted:
 *   1. protected + NULL reason → REJECT (the only impossible state)
 *   2. demoted-with-reason memory pin → ACCEPT
 *   3. fresh-unprotected (NULL reason) → ACCEPT
 *   4. protected + reason → ACCEPT (the normal happy path)
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

describe('sender_policies × protection_reason CHECK integration', () => {
  it('keeps the exact automatic-protection reasons closed', () => {
    expect(protectionReason.enumValues).toEqual([
      'user_defined',
      'replied',
      'starred',
      'gmail_important',
    ]);
  });

  it('CHECK rejects is_protected=true with NULL protection_reason', async () => {
    const db = await freshDb();
    const mbId = await seedMailbox(db);
    await expect(
      db.insert(senderPolicies).values({
        mailboxAccountId: mbId,
        senderKey: 'sender-violation',
        policyType: 'keep',
        isProtected: true,
        protectionReason: null,
      }),
    ).rejects.toThrow();
  });

  it('CHECK accepts the user-agency-wins memory pin (is_protected=false + non-null reason)', async () => {
    const db = await freshDb();
    const mbId = await seedMailbox(db);
    // The demoted-engagement state — user manually un-protected a
    // sender that auto-protect would otherwise re-protect on the next
    // sync. The lingering reason is the memory pin worker WHERE
    // clauses read as "user said no; do not re-protect."
    await db.insert(senderPolicies).values({
      mailboxAccountId: mbId,
      senderKey: 'sender-memory-pin',
      policyType: 'keep',
      isProtected: false,
      protectionReason: 'replied',
    });
    const rows = await db.select().from(senderPolicies);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.isProtected).toBe(false);
    expect(rows[0]!.protectionReason).toBe('replied');
  });

  it('CHECK accepts fresh unprotected row (NULL reason)', async () => {
    const db = await freshDb();
    const mbId = await seedMailbox(db);
    await db.insert(senderPolicies).values({
      mailboxAccountId: mbId,
      senderKey: 'sender-fresh',
      policyType: 'keep',
      isProtected: false,
      protectionReason: null,
    });
    const rows = await db.select().from(senderPolicies);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.isProtected).toBe(false);
    expect(rows[0]!.protectionReason).toBeNull();
  });

  it('CHECK accepts the happy path (is_protected=true + reason)', async () => {
    const db = await freshDb();
    const mbId = await seedMailbox(db);
    await db.insert(senderPolicies).values({
      mailboxAccountId: mbId,
      senderKey: 'sender-protected',
      policyType: 'keep',
      isProtected: true,
      protectionReason: 'user_defined',
      protectionSetAt: new Date(),
    });
    const rows = await db.select().from(senderPolicies);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.isProtected).toBe(true);
    expect(rows[0]!.protectionReason).toBe('user_defined');
  });

  it('CHECK rejects UPDATE that flips is_protected=true while wiping reason', async () => {
    const db = await freshDb();
    const mbId = await seedMailbox(db);
    await db.insert(senderPolicies).values({
      mailboxAccountId: mbId,
      senderKey: 'sender-update',
      policyType: 'keep',
      isProtected: true,
      protectionReason: 'user_defined',
    });
    // The forbidden transition: keep protected, drop the reason.
    await expect(
      db.execute(
        `UPDATE sender_policies SET protection_reason = NULL WHERE sender_key = 'sender-update'`,
      ),
    ).rejects.toThrow();
  });
});
