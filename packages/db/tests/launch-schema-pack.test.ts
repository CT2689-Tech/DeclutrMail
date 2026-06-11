import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  accountDeletionRequests,
  activityLog,
  automationRules,
  billingCustomers,
  cronRuns,
  mailboxAccounts,
  schema,
  screenerQuarantine,
  senderPolicies,
  subscriptionEvents,
  users,
  waitlist,
  workspaces,
} from '../src';

/**
 * Launch schema pack integration test (migration 0030 — D150, D232,
 * D225, D117, D78, D71–D76).
 *
 * Verifies the invariants the migration encodes:
 *
 *   1. `subscription_events (provider, provider_event_id)` UNIQUE is
 *      the webhook dedup gate — duplicate insert conflicts; the
 *      `ON CONFLICT DO NOTHING` path inserts zero rows.
 *   2. `billing_customers` — one customer per (workspace, provider);
 *      a provider customer id can never map to two workspaces.
 *   3. `account_deletion_requests` — the D232 typed-waiver CHECK
 *      ('waived-immediate' requires waiver_confirmed) and the
 *      one-in-flight-request-per-user partial unique (released once
 *      the prior request is cancelled).
 *   4. `activity_log.rule_id` — real FK; rule deletion nulls the
 *      attribution but the append-only audit row survives.
 *   5. `cron_runs.run_key` — the D225 cronPolicy dedup gate.
 *   6. `waitlist.email` — citext, so casing never duplicates a signup.
 *   7. `screener_quarantine` — one queue row per (mailbox, sender).
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

type Db = Awaited<ReturnType<typeof freshDb>>;

async function seedWorkspaceUser(db: Db): Promise<{ workspaceId: string; userId: string }> {
  const [ws] = await db.insert(workspaces).values({ name: 'WS' }).returning({
    id: workspaces.id,
  });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: ws!.id, email: 'a@b.com' })
    .returning({ id: users.id });
  return { workspaceId: ws!.id, userId: user!.id };
}

async function seedMailbox(db: Db): Promise<string> {
  const { workspaceId, userId } = await seedWorkspaceUser(db);
  const [mb] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId,
      userId,
      provider: 'gmail',
      providerAccountId: 'a@b.com',
    })
    .returning({ id: mailboxAccounts.id });
  return mb!.id;
}

describe('launch schema pack (migration 0030)', () => {
  it('dedups subscription events on (provider, provider_event_id)', async () => {
    const db = await freshDb();

    await db
      .insert(subscriptionEvents)
      .values({ provider: 'paddle', providerEventId: 'evt_1', eventType: 'subscription.updated' });

    // Same event id redelivered → unique violation.
    await expect(
      db.insert(subscriptionEvents).values({
        provider: 'paddle',
        providerEventId: 'evt_1',
        eventType: 'subscription.updated',
      }),
    ).rejects.toThrow();

    // The webhook handler's actual gate: ON CONFLICT DO NOTHING inserts 0 rows.
    const replay = await db
      .insert(subscriptionEvents)
      .values({
        provider: 'paddle',
        providerEventId: 'evt_1',
        eventType: 'subscription.updated',
      })
      .onConflictDoNothing()
      .returning({ id: subscriptionEvents.id });
    expect(replay).toHaveLength(0);

    // Same id under the other provider is a different event.
    const other = await db
      .insert(subscriptionEvents)
      .values({ provider: 'razorpay', providerEventId: 'evt_1', eventType: 'subscription.charged' })
      .returning({ id: subscriptionEvents.id });
    expect(other).toHaveLength(1);
  });

  it('keeps one billing customer per (workspace, provider) and per provider customer id', async () => {
    const db = await freshDb();
    const { workspaceId } = await seedWorkspaceUser(db);

    await db.insert(billingCustomers).values({
      workspaceId,
      provider: 'paddle',
      providerCustomerId: 'ctm_1',
      region: 'international',
    });

    // Second Paddle customer for the same workspace → violation.
    await expect(
      db.insert(billingCustomers).values({
        workspaceId,
        provider: 'paddle',
        providerCustomerId: 'ctm_2',
        region: 'international',
      }),
    ).rejects.toThrow();

    // Same provider customer id on another workspace → violation.
    const [ws2] = await db.insert(workspaces).values({ name: 'WS2' }).returning({
      id: workspaces.id,
    });
    await expect(
      db.insert(billingCustomers).values({
        workspaceId: ws2!.id,
        provider: 'paddle',
        providerCustomerId: 'ctm_1',
        region: 'international',
      }),
    ).rejects.toThrow();

    // The Razorpay slot for the original workspace stays open (region switch).
    const razorpay = await db
      .insert(billingCustomers)
      .values({
        workspaceId,
        provider: 'razorpay',
        providerCustomerId: 'cust_1',
        region: 'india',
      })
      .returning({ id: billingCustomers.id });
    expect(razorpay).toHaveLength(1);
  });

  it('rejects a waived-immediate deletion request without a confirmed waiver (D232)', async () => {
    const db = await freshDb();
    const { userId } = await seedWorkspaceUser(db);

    await expect(
      db.insert(accountDeletionRequests).values({
        userId,
        effectiveAt: new Date(),
        basis: 'waived-immediate',
        waiverConfirmed: false,
      }),
    ).rejects.toThrow();

    const ok = await db
      .insert(accountDeletionRequests)
      .values({
        userId,
        effectiveAt: new Date(),
        basis: 'waived-immediate',
        waiverConfirmed: true,
      })
      .returning({ id: accountDeletionRequests.id });
    expect(ok).toHaveLength(1);
  });

  it('allows at most one in-flight deletion request per user (D232)', async () => {
    const db = await freshDb();
    const { userId } = await seedWorkspaceUser(db);
    const in7d = new Date(Date.now() + 7 * 24 * 3600 * 1000);

    const [first] = await db
      .insert(accountDeletionRequests)
      .values({ userId, effectiveAt: in7d, basis: 'flat-grace' })
      .returning({ id: accountDeletionRequests.id });

    // Second pending request while one is in flight → violation.
    await expect(
      db.insert(accountDeletionRequests).values({ userId, effectiveAt: in7d, basis: 'flat-grace' }),
    ).rejects.toThrow();

    // Cancelling the first releases the slot.
    await db
      .update(accountDeletionRequests)
      .set({ status: 'cancelled', cancelledAt: new Date() })
      .where(eq(accountDeletionRequests.id, first!.id));
    const second = await db
      .insert(accountDeletionRequests)
      .values({ userId, effectiveAt: in7d, basis: 'undo-window' })
      .returning({ id: accountDeletionRequests.id });
    expect(second).toHaveLength(1);
  });

  it('nulls activity_log.rule_id when the rule is deleted; audit row survives (D58/D104)', async () => {
    const db = await freshDb();
    const mbId = await seedMailbox(db);

    const [rule] = await db
      .insert(automationRules)
      .values({
        mailboxAccountId: mbId,
        presetKey: 'auto_archive_low_engagement',
        name: 'Auto-archive low engagement',
        actionKind: 'archive',
      })
      .returning({ id: automationRules.id });

    const [entry] = await db
      .insert(activityLog)
      .values({
        mailboxAccountId: mbId,
        source: 'autopilot',
        action: 'archive',
        affectedCount: 3,
        ruleId: rule!.id,
      })
      .returning({ id: activityLog.id });

    // Unknown rule id is rejected — the attribution is a real FK.
    await expect(
      db.insert(activityLog).values({
        mailboxAccountId: mbId,
        source: 'autopilot',
        action: 'archive',
        ruleId: '00000000-0000-0000-0000-000000000000',
      }),
    ).rejects.toThrow();

    await db.delete(automationRules).where(eq(automationRules.id, rule!.id));
    const [after] = await db
      .select({ ruleId: activityLog.ruleId })
      .from(activityLog)
      .where(eq(activityLog.id, entry!.id));
    expect(after).toEqual({ ruleId: null });
  });

  it('dedups cron runs on run_key (D225 cronPolicy)', async () => {
    const db = await freshDb();

    const claimed = await db
      .insert(cronRuns)
      .values({ workerName: 'WatchRenewalWorker', runKey: 'WatchRenewalWorker:2026-06-11T06:00Z' })
      .onConflictDoNothing()
      .returning({ id: cronRuns.id });
    expect(claimed).toHaveLength(1);

    // A second replica claiming the same minute slot inserts nothing.
    const duplicate = await db
      .insert(cronRuns)
      .values({ workerName: 'WatchRenewalWorker', runKey: 'WatchRenewalWorker:2026-06-11T06:00Z' })
      .onConflictDoNothing()
      .returning({ id: cronRuns.id });
    expect(duplicate).toHaveLength(0);
  });

  it('dedups waitlist emails case-insensitively (citext)', async () => {
    const db = await freshDb();

    await db.insert(waitlist).values({ email: 'Founder@Example.com', tierInterest: 'pro' });
    await expect(db.insert(waitlist).values({ email: 'founder@example.com' })).rejects.toThrow();
  });

  it('keeps one screener queue row per (mailbox, sender)', async () => {
    const db = await freshDb();
    const mbId = await seedMailbox(db);

    await db.insert(screenerQuarantine).values({ mailboxAccountId: mbId, senderKey: 'abc123' });
    await expect(
      db.insert(screenerQuarantine).values({ mailboxAccountId: mbId, senderKey: 'abc123' }),
    ).rejects.toThrow();

    // Deciding the sender leaves the row (audit) but clears it from the pending read.
    await db
      .update(screenerQuarantine)
      .set({ decidedAt: new Date() })
      .where(eq(screenerQuarantine.senderKey, 'abc123'));
    const pending = await db
      .select({ id: screenerQuarantine.id })
      .from(screenerQuarantine)
      .where(eq(screenerQuarantine.mailboxAccountId, mbId));
    expect(pending).toHaveLength(1);
  });

  it('round-trips sender snooze state (D78/D79)', async () => {
    const db = await freshDb();
    const mbId = await seedMailbox(db);
    const wake = new Date('2026-06-12T09:00:00Z');

    await db.insert(senderPolicies).values({
      mailboxAccountId: mbId,
      senderKey: 'abc123',
      policyType: 'keep',
      snoozedUntil: wake,
      snoozedAt: new Date('2026-06-11T08:00:00Z'),
      snoozedReason: 'travel week',
    });

    const [row] = await db
      .select({
        snoozedUntil: senderPolicies.snoozedUntil,
        snoozedReason: senderPolicies.snoozedReason,
      })
      .from(senderPolicies)
      .where(eq(senderPolicies.senderKey, 'abc123'));
    expect(row).toEqual({ snoozedUntil: wake, snoozedReason: 'travel week' });
  });
});
