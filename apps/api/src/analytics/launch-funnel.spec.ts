import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  actionJobs,
  activityLog,
  mailboxAccounts,
  productEvents,
  subscriptions,
  users,
  workspaces,
} from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import { TIER_MANIFEST } from '@declutrmail/shared/entitlements';
import { describe, expect, it } from 'vitest';

import { EntitlementsService } from '../common/entitlements/entitlements.service.js';
import { earliestWorkspaceUserId } from './earliest-workspace-user.js';
import { ProductEventsWriter } from './product-events.writer.js';
import { scheduleProductEvent } from './schedule-product-event.js';
import {
  assertLocalFunnelDsn,
  funnelSql,
  funnelWindowFromEnv,
} from '../../../../scripts/launch-funnel-sql';
import { formatFunnelReport } from '../../../../scripts/launch-funnel-report';

const FREE_LIMIT = TIER_MANIFEST.free.cleanupActionsPerMonth!;

describe('product event writer', () => {
  it('binds the real writer instead of the no-op', () => {
    const source = readFileSync(new URL('./product-events.module.ts', import.meta.url), 'utf8');
    expect(source).toContain('useClass: ProductEventsWriter');
    expect(source).not.toContain('NoopProductEvents');
  });

  it('does not throw when the insert rejects', async () => {
    const failing = {
      insert: () => ({
        values: () => Promise.reject(new Error('db down')),
      }),
    };
    expect(() =>
      scheduleProductEvent(failing, 'signup_completed', { provider: 'google' }),
    ).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('does not store an email address or an unknown prop', async () => {
    const db = await freshTestDb();
    const writer = new ProductEventsWriter(db as never);
    writer.record('signup_completed', { provider: 'ada@example.com' });
    writer.record('gmail_connected', { mode: 'login', subject: 'hello' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await db.select().from(productEvents)).toEqual([]);
  });

  it('rejects an at-sign at the database check', async () => {
    const db = await freshTestDb();
    await expect(
      db.insert(productEvents).values({
        event: 'signup_completed',
        props: { provider: 'ada@example.com' },
      }),
    ).rejects.toThrow();
  });

  it('rejects a nested subject and a free-text template at the database check', async () => {
    const db = await freshTestDb();
    await expect(
      db.insert(productEvents).values({
        event: 'email_link_clicked',
        props: { kind: { subject: 'Weekly update', token: 'ya29.secret' } } as never,
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(productEvents).values({
        event: 'email_link_clicked',
        props: { template: 'Your receipt is ready' },
      }),
    ).rejects.toThrow();
    expect(await db.select().from(productEvents)).toEqual([]);
    const migration = readFileSync(
      new URL('../../../../packages/db/migrations/0086_product_events.sql', import.meta.url),
      'utf8',
    );
    expect(migration).toContain(`jsonb_typeof("props"->'kind') = 'string'`);
    expect(migration).toContain(`jsonb_typeof("props"->'template') = 'string'`);
  });

  it('records free_cap_hit from the entitlement gate and keeps the row', async () => {
    const db = await freshTestDb();
    const [ws] = await db
      .insert(workspaces)
      .values({ name: 'Free', tier: 'free' })
      .returning({ id: workspaces.id, createdAt: workspaces.createdAt });
    const writer = new ProductEventsWriter(db as never);
    const entitlements = new EntitlementsService(db as never, writer);
    await expect(
      entitlements.assertCleanupCapacityForWorkspace(
        { workspaceId: ws!.id, tier: 'free', createdAt: ws!.createdAt },
        FREE_LIMIT + 1,
      ),
    ).rejects.toMatchObject({ code: 'FREE_CAP_REACHED' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const rows = await db.select().from(productEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      event: 'free_cap_hit',
      userId: null,
      props: { requested_bucket: '11-100' },
    });
  });

  it('stores the earliest workspace user on free_cap_hit and not their email', async () => {
    const db = await freshTestDb();
    const [ws] = await db
      .insert(workspaces)
      .values({ name: 'Free', tier: 'free' })
      .returning({ id: workspaces.id, createdAt: workspaces.createdAt });
    const [earlier] = await db
      .insert(users)
      .values({
        workspaceId: ws!.id,
        email: 'earlier@example.com',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      })
      .returning({ id: users.id });
    await db.insert(users).values({
      workspaceId: ws!.id,
      email: 'later@example.com',
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
    });
    const writer = new ProductEventsWriter(db as never);
    const entitlements = new EntitlementsService(db as never, writer);
    await expect(
      entitlements.assertCleanupCapacityForWorkspace(
        { workspaceId: ws!.id, tier: 'free', createdAt: ws!.createdAt },
        FREE_LIMIT + 1,
      ),
    ).rejects.toMatchObject({ code: 'FREE_CAP_REACHED' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const rows = await db.select().from(productEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      event: 'free_cap_hit',
      userId: earlier!.id,
      props: { requested_bucket: '11-100' },
    });
    expect(JSON.stringify(rows)).not.toContain('@');
    expect(await earliestWorkspaceUserId(db, ws!.id)).toBe(earlier!.id);
  });

  it('keeps the billing record() calls that this writer serves', () => {
    const root = join(process.cwd(), 'src/billing');
    const checkout = readFileSync(join(root, 'billing.service.ts'), 'utf8');
    const paid = readFileSync(join(root, 'billing-webhook.service.ts'), 'utf8');
    const gate = readFileSync(
      join(process.cwd(), 'src/common/entitlements/entitlements.service.ts'),
      'utf8',
    );
    const lookup = readFileSync(new URL('./earliest-workspace-user.ts', import.meta.url), 'utf8');
    expect(checkout).toMatch(/recordProductEvent\(\s*this\.productEvents,\s*'checkout_created'/);
    expect(paid).toMatch(
      /recordProductEvent\(\s*this\.productEvents,\s*'purchase_confirmed',\s*\{ plan: tier \},\s*userId\s*\)/,
    );
    expect(gate).toMatch(
      /recordProductEvent\(\s*this\.productEvents,\s*'free_cap_hit',[\s\S]*?,\s*userId,\s*\)/,
    );
    expect(lookup).toContain('id: users.id');
    expect(lookup).not.toContain('users.email');
  });
});

describe('launch funnel sql', () => {
  it('uses elapsed-hour D7 windows across daylight-saving changes', async () => {
    const db = await freshTestDb();
    await db.execute("SET TIME ZONE 'America/Los_Angeles'");
    const account = await seedUser(db, 'dst@example.test', new Date('2026-10-28T12:00:00Z'));
    const [action] = await db
      .insert(actionJobs)
      .values(job(account.mailboxId, new Date('2026-11-04T12:00:00Z'), 10, 'dst'))
      .returning();
    await db.insert(activityLog).values({
      mailboxAccountId: account.mailboxId,
      actionJobId: action!.id,
      source: 'manual',
      action: 'archive',
      affectedCount: 10,
      occurredAt: new Date('2026-11-04T12:30:00Z'),
    });
    const row = oneRow(
      await db.execute(funnelSql({ observedAt: new Date('2026-11-05T12:00:00Z') })),
    );
    expect(Number(row.d7_eligible_accounts)).toBe(1);
    expect(Number(row.d7_completed_cleanup_accounts)).toBe(1);
  });

  it('rejects an impossible calendar date instead of normalizing it', () => {
    expect(() =>
      funnelWindowFromEnv({ LAUNCH_FUNNEL_OBSERVED_AT: '2026-02-30T00:00:00Z' }),
    ).toThrow(/invalid/);
  });

  it('prints unknown rates when no account has a mature window', async () => {
    const db = await freshTestDb();
    const signup = new Date('2026-01-10T00:00:00Z');
    await seedUser(db, 'young@example.test', signup);
    const row = oneRow(
      await db.execute(funnelSql({ observedAt: new Date('2026-01-10T00:01:00Z') })),
    );
    expect(Number(row.eligible_accounts)).toBe(1);
    for (const key of [
      'first_sync_ready_2h_event_rate',
      'first_completed_cleanup_24h_rate',
      'd7_completed_cleanup_rate',
      'connection_to_completed_cleanup_24h_rate',
      'recorded_sync_success_rate',
    ]) {
      expect(row[key]).toBeNull();
    }
  });

  it('excludes immature D7 accounts from both numerator and denominator', async () => {
    const db = await freshTestDb();
    const mature = await seedUser(db, 'mature@example.test', new Date('2026-01-03T00:00:00Z'));
    const young = await seedUser(db, 'not-mature@example.test', new Date('2026-01-03T00:01:00Z'));
    for (const account of [mature, young]) {
      const [action] = await db
        .insert(actionJobs)
        .values(job(account.mailboxId, new Date('2026-01-10T01:00:00Z'), 10, account.userId))
        .returning();
      await db.insert(activityLog).values({
        mailboxAccountId: account.mailboxId,
        actionJobId: action!.id,
        source: 'manual',
        action: 'archive',
        affectedCount: 10,
        occurredAt: new Date('2026-01-10T01:01:00Z'),
      });
    }
    const row = oneRow(
      await db.execute(funnelSql({ observedAt: new Date('2026-01-11T00:00:00Z') })),
    );
    expect(Number(row.d7_eligible_accounts)).toBe(1);
    expect(Number(row.d7_completed_cleanup_accounts)).toBe(1);
    expect(Number(row.d7_completed_cleanup_rate)).toBe(1);
  });

  it('does not invent a completion time from a done job without matching manual activity', async () => {
    const db = await freshTestDb();
    const account = await seedUser(db, 'untimed@example.test', new Date('2026-01-01T00:00:00Z'));
    await db
      .insert(actionJobs)
      .values(job(account.mailboxId, new Date('2026-01-01T01:00:00Z'), 10, 'untimed'));
    const row = oneRow(await db.execute(funnelSql()));
    expect(Number(row.first_completed_cleanup_24h_accounts)).toBe(0);
    expect(Number(row.cleanup_jobs_without_observed_manual_completion)).toBe(1);
  });

  it('does not reset the conversion clock at a later reconnection', async () => {
    const db = await freshTestDb();
    const account = await seedUser(db, 'reconnect@example.test', new Date('2026-01-01T00:00:00Z'));
    await db.insert(productEvents).values([
      {
        userId: account.userId,
        event: 'gmail_connected',
        occurredAt: new Date('2026-01-01T01:00:00Z'),
      },
      {
        userId: account.userId,
        event: 'gmail_connected',
        occurredAt: new Date('2026-01-02T03:00:00Z'),
      },
    ]);
    const [action] = await db
      .insert(actionJobs)
      .values(job(account.mailboxId, new Date('2026-01-02T03:30:00Z'), 10, 'after-reconnect'))
      .returning();
    await db.insert(activityLog).values({
      mailboxAccountId: account.mailboxId,
      actionJobId: action!.id,
      source: 'manual',
      action: 'archive',
      affectedCount: 10,
      occurredAt: new Date('2026-01-02T04:00:00Z'),
    });
    expect(
      Number(oneRow(await db.execute(funnelSql())).connection_to_completed_cleanup_24h_accounts),
    ).toBe(0);
  });

  it('applies exclusive cohort/cutoff bounds and explicit exclusions', async () => {
    const db = await freshTestDb();
    const inside = await seedUser(db, 'inside@example.test', new Date('2026-01-02T00:00:00Z'));
    const excluded = await seedUser(db, 'excluded@example.test', new Date('2026-01-02T00:00:00Z'));
    await seedUser(db, 'outside@example.test', new Date('2026-01-01T23:59:59Z'));
    await seedUser(db, 'at-end@example.test', new Date('2026-01-03T00:00:00Z'));
    await db.insert(productEvents).values([
      {
        userId: inside.userId,
        event: 'purchase_confirmed',
        props: { plan: 'pass' },
        occurredAt: new Date('2026-01-04T00:00:00Z'),
      },
      {
        userId: excluded.userId,
        event: 'purchase_confirmed',
        props: { plan: 'pass' },
        occurredAt: new Date('2026-01-03T00:00:00Z'),
      },
    ]);
    const row = oneRow(
      await db.execute(
        funnelSql({
          cohortStart: new Date('2026-01-02T00:00:00Z'),
          cohortEnd: new Date('2026-01-03T00:00:00Z'),
          observedAt: new Date('2026-01-04T00:00:00Z'),
          extraUserIds: [excluded.userId],
        }),
      ),
    );
    expect(Number(row.eligible_accounts)).toBe(1);
    expect(Number(row.purchase_event_accounts)).toBe(0);
    expect(Number(row.cleanup_24h_eligible_accounts)).toBe(1);
  });

  it('rejects ambiguous timestamps, invalid ranges and malformed exclusion IDs', () => {
    expect(() => funnelWindowFromEnv({ LAUNCH_FUNNEL_OBSERVED_AT: '2026-01-01' })).toThrow(
      /timezone/,
    );
    expect(() => funnelWindowFromEnv({ LAUNCH_FUNNEL_OBSERVED_AT: 'not-a-date' })).toThrow(
      /timestamp/,
    );
    expect(() =>
      funnelSql({ cohortStart: new Date('2026-01-02'), cohortEnd: new Date('2026-01-01') }),
    ).toThrow(/require cohort/);
    expect(() =>
      funnelSql({ cohortEnd: new Date('2026-01-03'), observedAt: new Date('2026-01-02') }),
    ).toThrow(/require cohort/);
    expect(() => funnelSql({ observedAt: new Date('invalid') })).toThrow(
      /invalid report timestamp/,
    );
    expect(() => funnelSql({ extraUserIds: ["x'); SELECT 1; --"] })).toThrow(/uuid/);
    const env = funnelWindowFromEnv({ LAUNCH_FUNNEL_OBSERVED_AT: '2026-01-10T01:00:00+01:00' });
    expect(env.observedAt.toISOString()).toBe('2026-01-10T00:00:00.000Z');
    expect(() => formatFunnelReport({ email: 'private@example.test' })).toThrow(/unexpected email/);
  });

  it('does not treat queued, executing, failed or zero-effect work as first cleanup', async () => {
    const db = await freshTestDb();
    const signup = new Date('2026-01-01T00:00:00Z');
    for (const status of ['queued', 'executing', 'failed', 'done'] as const) {
      const account = await seedUser(db, `${status}@example.test`, signup);
      await db.insert(actionJobs).values({
        ...job(
          account.mailboxId,
          new Date('2026-01-01T01:00:00Z'),
          status === 'done' ? 0 : 10,
          status,
        ),
        status,
      });
    }
    expect(Number(oneRow(await db.execute(funnelSql())).first_completed_cleanup_24h_accounts)).toBe(
      0,
    );
  });

  it('does not count cleanup before the first recorded Gmail connection', async () => {
    const db = await freshTestDb();
    const account = await seedUser(db, 'chronology@example.test', new Date('2026-01-01T00:00:00Z'));
    await db.insert(productEvents).values({
      userId: account.userId,
      event: 'gmail_connected',
      occurredAt: new Date('2026-01-01T04:00:00Z'),
    });
    const [action] = await db
      .insert(actionJobs)
      .values(job(account.mailboxId, new Date('2026-01-01T01:00:00Z'), 10, 'before-connect'))
      .returning();
    await db.insert(activityLog).values({
      mailboxAccountId: account.mailboxId,
      actionJobId: action!.id,
      source: 'manual',
      action: 'archive',
      affectedCount: 10,
      occurredAt: new Date('2026-01-01T01:30:00Z'),
    });
    expect(
      Number(oneRow(await db.execute(funnelSql())).connection_to_completed_cleanup_24h_accounts),
    ).toBe(0);
  });

  it('uses completion time instead of enqueue time for first cleanup', async () => {
    const db = await freshTestDb();
    const account = await seedUser(db, 'completion@example.test', new Date('2026-01-01T00:00:00Z'));
    const [action] = await db
      .insert(actionJobs)
      .values(job(account.mailboxId, new Date('2026-01-01T01:00:00Z'), 10, 'slow-completion'))
      .returning();
    await db.insert(activityLog).values({
      mailboxAccountId: account.mailboxId,
      actionJobId: action!.id,
      source: 'manual',
      action: 'archive',
      affectedCount: 10,
      occurredAt: new Date('2026-01-02T01:00:00Z'),
    });
    expect(Number(oneRow(await db.execute(funnelSql())).first_completed_cleanup_24h_accounts)).toBe(
      0,
    );
  });

  it('does not count an unobserved future D7 action', async () => {
    const db = await freshTestDb();
    const signup = new Date();
    const account = await seedUser(db, 'immature@example.test', signup);
    const future = new Date(signup.getTime() + 7 * 86400_000 + 3600_000);
    await db.insert(actionJobs).values(job(account.mailboxId, future, 10, 'future-d7'));
    expect(Number(oneRow(await db.execute(funnelSql())).d7_completed_cleanup_accounts)).toBe(0);
  });

  it('separates unattributed telemetry from purchase-event accounts and unknown paying customers', async () => {
    const db = await freshTestDb();
    const ada = await seedUser(db, 'ada@example.com');
    const now = new Date();
    await db.insert(productEvents).values({
      userId: null,
      event: 'purchase_confirmed',
      props: { plan: 'plus' },
      occurredAt: now,
    });
    const missing = oneRow(await db.execute(funnelSql()));
    expect(Number(missing.purchase_event_accounts)).toBe(0);
    expect(Number(missing.unattributed_purchase_events_in_observation_range)).toBe(1);
    expect(missing.verified_external_paying_customers).toBeNull();
    expect(Number(missing.plus_purchase_events)).toBe(0);

    await db.insert(productEvents).values({
      userId: ada.userId,
      event: 'purchase_confirmed',
      props: { plan: 'plus' },
      occurredAt: now,
    });
    const counted = oneRow(await db.execute(funnelSql()));
    expect(Number(counted.purchase_event_accounts)).toBe(1);
    expect(counted.verified_external_paying_customers).toBeNull();
    expect(Number(counted.plus_purchase_events)).toBe(1);
  });

  it('refuses a non-local database', () => {
    expect(() =>
      assertLocalFunnelDsn('postgresql://postgres@127.0.0.1:5432/declutrmail'),
    ).not.toThrow();
    expect(() =>
      assertLocalFunnelDsn('postgresql://postgres@db.example.com:5432/declutrmail'),
    ).toThrow(/refuses non-local/);
    expect(() =>
      assertLocalFunnelDsn('postgresql://postgres@localhost:5432/postgres.supabase.co'),
    ).toThrow(/refuses non-local/);
  });

  it('excludes internal accounts and never returns an email', async () => {
    const db = await freshTestDb();
    const signup = new Date('2026-01-01T00:00:00Z');
    const now = new Date('2026-01-01T01:00:00Z');
    const week = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000);
    const ada = await seedUser(db, 'ada@example.com', signup);
    const bob = await seedUser(db, 'bob@example.com', signup);
    const internal = await seedUser(db, 'chintan@example.com', signup);

    await db.insert(productEvents).values([
      { userId: ada.userId, event: 'gmail_connected', props: { mode: 'login' }, occurredAt: now },
      {
        userId: ada.userId,
        event: 'first_sync_ready',
        props: { duration_s: 60, emails: 100 },
        occurredAt: now,
      },
      { userId: ada.userId, event: 'checkout_created', props: { plan: 'plus' }, occurredAt: now },
      { userId: ada.userId, event: 'purchase_confirmed', props: { plan: 'plus' }, occurredAt: now },
      {
        userId: ada.userId,
        event: 'free_cap_hit',
        props: { requested_bucket: '1' },
        occurredAt: now,
      },
      { userId: bob.userId, event: 'purchase_confirmed', props: { plan: 'pass' }, occurredAt: now },
      {
        userId: bob.userId,
        event: 'first_sync_failed_terminal',
        props: { error_class: 'TransientError' },
        occurredAt: now,
      },
      {
        userId: internal.userId,
        event: 'gmail_connected',
        props: { mode: 'login' },
        occurredAt: now,
      },
      {
        userId: internal.userId,
        event: 'purchase_confirmed',
        props: { plan: 'plus' },
        occurredAt: now,
      },
    ]);
    const actions = await db
      .insert(actionJobs)
      .values([
        job(ada.mailboxId, now, 40, 'ada-now'),
        job(ada.mailboxId, week, 1, 'ada-d7'),
        job(internal.mailboxId, now, 40, 'internal-now'),
      ])
      .returning();
    await db.insert(activityLog).values(
      actions.map((action) => ({
        mailboxAccountId: action.mailboxAccountId,
        actionJobId: action.id,
        source: 'manual' as const,
        action: 'archive' as const,
        affectedCount: action.affectedCount,
        occurredAt: action.createdAt,
      })),
    );
    await db.insert(subscriptions).values({
      workspaceId: ada.workspaceId,
      provider: 'paddle',
      providerSubscriptionId: 'sub_ada',
      providerPriceId: 'pri_plus',
      tier: 'plus',
      billingCycle: 'monthly',
      status: 'canceled',
      cancelSource: 'refund',
    });

    const rows = await db.execute(funnelSql());
    const row = oneRow(rows);
    expect(JSON.stringify(row)).not.toContain('@');
    expect(Number(row.eligible_accounts)).toBe(2);
    expect(Number(row.connection_event_accounts)).toBe(1);
    expect(Number(row.first_sync_ready_2h_event_accounts)).toBe(1);
    expect(Number(row.first_completed_cleanup_24h_accounts)).toBe(1);
    expect(Number(row.d7_completed_cleanup_accounts)).toBe(1);
    expect(Number(row.checkout_event_accounts)).toBe(1);
    expect(Number(row.purchase_event_accounts)).toBe(2);
    expect(Number(row.recorded_sync_success_rate)).toBeCloseTo(0.5);
    expect(Number(row.recorded_first_sync_p50_s)).toBe(60);
    expect(Number(row.connection_to_completed_cleanup_24h_accounts)).toBe(1);
    expect(Number(row.archive_delete_emails_completed_7d)).toBe(40);
    expect(row).not.toHaveProperty('free_near_allowance_7d');
    expect(Number(row.free_cap_hit_events)).toBe(1);
    expect(Number(row.pass_purchase_events)).toBe(1);
    expect(Number(row.plus_purchase_events)).toBe(1);
    expect(row.verified_external_paying_customers).toBeNull();
    expect(Number(row.cleanup_24h_eligible_accounts)).toBe(2);
    expect(Number(row.first_completed_cleanup_24h_rate)).toBeCloseTo(0.5);
    expect(Number(row.d7_eligible_accounts)).toBe(2);
    expect(Number(row.d7_completed_cleanup_rate)).toBeCloseTo(0.5);
    const rendered = formatFunnelReport(row);
    expect(rendered).toContain('not verified customers');
    expect(rendered).toContain('not monthly quota');
    expect(rendered).toContain('verified_external_paying_customers: null');
    expect(rendered).not.toContain('@');
  });
});

async function seedUser(
  db: Awaited<ReturnType<typeof freshTestDb>>,
  email: string,
  createdAt = new Date(),
): Promise<{ userId: string; workspaceId: string; mailboxId: string }> {
  const [ws] = await db
    .insert(workspaces)
    .values({ name: email, tier: 'free' })
    .returning({ id: workspaces.id });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: ws!.id, email, createdAt })
    .returning({ id: users.id });
  const [mailbox] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId: ws!.id,
      userId: user!.id,
      provider: 'gmail',
      providerAccountId: email,
    })
    .returning({ id: mailboxAccounts.id });
  return { userId: user!.id, workspaceId: ws!.id, mailboxId: mailbox!.id };
}

function job(mailboxId: string, createdAt: Date, affected: number, key: string) {
  return {
    mailboxAccountId: mailboxId,
    verb: 'archive' as const,
    direction: 'forward' as const,
    selector: { type: 'messages' as const },
    status: 'done' as const,
    affectedCount: affected,
    idempotencyKey: key,
    createdAt,
  };
}

function oneRow(result: unknown): Record<string, unknown> {
  const rows = Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows;
  expect(rows).toHaveLength(1);
  return rows![0] as Record<string, unknown>;
}
