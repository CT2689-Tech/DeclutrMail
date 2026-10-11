import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  actionJobs,
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
import { assertLocalFunnelDsn, funnelSql } from '../../../../scripts/launch-funnel-sql';

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
  it('pins the free allowance to the pricing manifest', () => {
    const source = readFileSync(
      join(process.cwd(), '../../scripts/sql/launch-funnel-report.sql'),
      'utf8',
    );
    expect(source).toContain(`${FREE_LIMIT}::int AS free_allowance`);
  });

  it('leaves paid at 0 when purchase_confirmed has no user id', async () => {
    const db = await freshTestDb();
    const ada = await seedUser(db, 'ada@example.com');
    const now = new Date();
    await db.insert(productEvents).values({
      userId: null,
      event: 'purchase_confirmed',
      props: { plan: 'plus' },
      occurredAt: now,
    });
    const missing = oneRow(await db.execute(funnelSql(FREE_LIMIT, [])));
    expect(Number(missing.paid)).toBe(0);
    expect(Number(missing.plus_purchases)).toBe(0);

    await db.insert(productEvents).values({
      userId: ada.userId,
      event: 'purchase_confirmed',
      props: { plan: 'plus' },
      occurredAt: now,
    });
    const counted = oneRow(await db.execute(funnelSql(FREE_LIMIT, [])));
    expect(Number(counted.paid)).toBe(1);
    expect(Number(counted.plus_purchases)).toBe(1);
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
    const now = new Date();
    const week = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000);
    const ada = await seedUser(db, 'ada@example.com');
    const bob = await seedUser(db, 'bob@example.com');
    const internal = await seedUser(db, 'chintan@example.com');

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
    await db
      .insert(actionJobs)
      .values([
        job(ada.mailboxId, now, 40, 'ada-now'),
        job(ada.mailboxId, week, 1, 'ada-d7'),
        job(internal.mailboxId, now, 40, 'internal-now'),
      ]);
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

    const rows = await db.execute(funnelSql(FREE_LIMIT, []));
    const row = oneRow(rows);
    expect(JSON.stringify(row)).not.toContain('@');
    expect(Number(row.signups)).toBe(2);
    expect(Number(row.connected)).toBe(1);
    expect(Number(row.first_sync_ready_2h)).toBe(1);
    expect(Number(row.first_action_24h)).toBe(1);
    expect(Number(row.d7_action)).toBe(1);
    expect(Number(row.checkout_created)).toBe(1);
    expect(Number(row.paid)).toBe(2);
    expect(Number(row.first_sync_success_rate)).toBeCloseTo(0.5);
    expect(Number(row.first_sync_p50_s)).toBe(60);
    expect(Number(row.connected_to_action_24h)).toBe(1);
    expect(Number(row.free_near_allowance_7d)).toBe(1);
    expect(Number(row.free_cap_hit)).toBe(1);
    expect(Number(row.pass_purchases)).toBe(1);
    expect(Number(row.plus_purchases)).toBe(1);
    expect(Number(row.refunds)).toBe(1);
  });
});

async function seedUser(
  db: Awaited<ReturnType<typeof freshTestDb>>,
  email: string,
): Promise<{ userId: string; workspaceId: string; mailboxId: string }> {
  const [ws] = await db
    .insert(workspaces)
    .values({ name: email, tier: 'free' })
    .returning({ id: workspaces.id });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: ws!.id, email })
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
