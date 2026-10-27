import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { entitlementGrants, schema, subscriptionEvents, users, workspaces } from '@declutrmail/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AutopilotReadService } from '../../autopilot/autopilot.read-service.js';
import type { DrizzleDb } from '../../db/db.module.js';
import { BillingCatalog } from '../billing-catalog.js';
import type { NormalizedBillingEvent } from '../billing-provider.interface.js';
import { runBillingReconciliationSweep } from '../billing-reconciliation.sweep.js';
import { BillingWebhookService } from '../billing-webhook.service.js';
import { ordinaryRefundPolicy } from './fixtures.js';

// Separate database: the quota concurrency spec resets its public schema, so
// sharing its database would race even though each spec owns its fixture rows.
const sourceUrl = process.env.CLEANUP_TEST_PG_URL;
const database = `declutrmail_pass_${randomUUID().replaceAll('-', '')}_test`;
type Client = ReturnType<typeof postgres>;
let admin: Client;
let control: Client;
let first: Client;
let second: Client;

function service(client: Client) {
  const db = drizzle(client, { schema }) as unknown as DrizzleDb;
  return new BillingWebhookService(
    db,
    new BillingCatalog([], 250, 'pri_concurrency_pass'),
    new AutopilotReadService(db),
    ordinaryRefundPolicy,
  );
}
function refund(transactionId: string): NormalizedBillingEvent {
  return {
    kind: 'pass_revoked',
    providerTransactionId: transactionId,
    reason: 'refund',
    eventType: 'reconciliation.pass_refund',
    providerEventId: 'recon-test:' + transactionId,
  };
}
async function waitForBlocked(pid: number) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const rows = await admin<
      { waiting: boolean }[]
    >`SELECT wait_event_type = 'Lock' AS waiting FROM pg_stat_activity WHERE pid=${pid}`;
    if (rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Expected real workspace lock contention');
}

describe.skipIf(!sourceUrl)('Pass refund projection on real PostgreSQL', () => {
  beforeAll(async () => {
    const url = new URL(sourceUrl!);
    if (
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      !url.pathname.endsWith('_test')
    )
      throw new Error('CLEANUP_TEST_PG_URL must be a loopback disposable _test database');
    admin = postgres(url.toString(), { max: 1, prepare: false, onnotice: () => {} });
    await admin.unsafe(`CREATE DATABASE "${database}"`);
    url.pathname = '/' + database;
    const connect = () => postgres(url.toString(), { max: 1, prepare: false, onnotice: () => {} });
    control = connect();
    first = connect();
    second = connect();
    const migrations = resolve(import.meta.dirname, '../../../../../packages/db/migrations');
    for (const name of readdirSync(migrations)
      .filter((n) => n.endsWith('.sql'))
      .sort())
      for (const statement of readFileSync(resolve(migrations, name), 'utf8').split(
        '--> statement-breakpoint',
      ))
        if (statement.trim()) await control.unsafe(statement);
  });
  afterAll(async () => {
    await Promise.all([control?.end(), first?.end(), second?.end()]);
    if (admin) {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${database}"`);
      await admin.end();
    }
  });

  it('serializes two different Pass refunds before reading the remaining grants', async () => {
    const fixture = drizzle(control, { schema });
    const [ws] = await fixture
      .insert(workspaces)
      .values({ name: 'Concurrent Pass', tier: 'plus' })
      .returning();
    const email = 'pass-' + ws!.id + '@example.test';
    await fixture.insert(users).values({ workspaceId: ws!.id, email });
    await fixture.insert(entitlementGrants).values(
      ['txn_A', 'txn_B'].map((id) => ({
        email,
        tier: 'plus' as const,
        source: 'pass',
        provider: 'paddle',
        providerTransactionId: id,
        reason: 'backlog_pass',
        grantedBy: 'paddle',
        expiresAt: new Date(Date.now() + 86400000),
      })),
    );
    const [a] = await first<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    const [b] = await second<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    await control`BEGIN`;
    await control`SELECT id FROM workspaces WHERE id=${ws!.id} FOR UPDATE`;
    const one = service(first).process('paddle', refund('txn_A'), {});
    const pending: Promise<unknown>[] = [one];
    try {
      await waitForBlocked(a!.pid);
      const two = service(second).process('paddle', refund('txn_B'), {});
      pending.push(two);
      await waitForBlocked(b!.pid);
    } finally {
      await control`COMMIT`;
    }
    await Promise.all(pending);
    expect(
      (await fixture.select().from(workspaces).where(eq(workspaces.id, ws!.id)))[0]!.tier,
    ).toBe('free');
    expect(
      (await fixture.select().from(entitlementGrants)).every((g) => g.revokedAt !== null),
    ).toBe(true);
    expect(
      (await fixture.select().from(subscriptionEvents)).every((e) => e.processedAt !== null),
    ).toBe(true);
  });
  it('a delayed purchase projection cannot restore its already-refunded grant', async () => {
    const fixture = drizzle(control, { schema });
    const [ws] = await fixture
      .insert(workspaces)
      .values({ name: 'Late purchase', tier: 'plus' })
      .returning();
    const email = 'late-' + ws!.id + '@example.test';
    await fixture.insert(users).values({ workspaceId: ws!.id, email });
    await fixture.insert(entitlementGrants).values({
      email,
      tier: 'plus',
      source: 'pass',
      provider: 'paddle',
      providerTransactionId: 'txn_late',
      reason: 'backlog_pass',
      grantedBy: 'paddle',
      expiresAt: new Date(Date.now() + 86400000),
    });
    const [a] = await first<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    const [b] = await second<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    await control`BEGIN`;
    await control`SELECT id FROM workspaces WHERE id=${ws!.id} FOR UPDATE`;
    // Queue the refund before the purchase's projection. Without the read lock,
    // the purchase computes Plus while the refund's grant update is uncommitted,
    // then overwrites the refund's Free after the control lock is released.
    const one = service(first).process('paddle', refund('txn_late'), {});
    const pending: Promise<unknown>[] = [one];
    try {
      await waitForBlocked(a!.pid);
      pending.push(
        service(second).process(
          'paddle',
          {
            kind: 'payment',
            outcome: 'succeeded',
            providerSubscriptionId: null,
            providerCustomerId: null,
            workspaceId: ws!.id,
            providerTransactionId: 'txn_late',
            oneTimePriceIds: ['pri_concurrency_pass'],
            providerEventId: 'evt_late_purchase',
            eventType: 'transaction.completed',
          },
          {},
        ),
      );
      await waitForBlocked(b!.pid);
    } finally {
      await control`COMMIT`;
    }
    await Promise.all(pending);
    expect(
      (await fixture.select().from(workspaces).where(eq(workspaces.id, ws!.id)))[0]!.tier,
    ).toBe('free');
    expect(
      (
        await fixture
          .select()
          .from(entitlementGrants)
          .where(eq(entitlementGrants.providerTransactionId, 'txn_late'))
      )[0]!.revokedAt,
    ).not.toBeNull();
  });
  it('the global tier sweep cannot overwrite a concurrent refund with its old grant snapshot', async () => {
    const fixture = drizzle(control, { schema });
    const [ws] = await fixture
      .insert(workspaces)
      .values({ name: 'Sweep race', tier: 'plus' })
      .returning();
    const email = 'sweep-' + ws!.id + '@example.test';
    await fixture.insert(users).values({ workspaceId: ws!.id, email });
    await fixture.insert(entitlementGrants).values({
      email,
      tier: 'plus',
      source: 'pass',
      provider: 'paddle',
      providerTransactionId: 'txn_sweep',
      reason: 'backlog_pass',
      grantedBy: 'paddle',
      expiresAt: new Date(Date.now() + 86400000),
    });
    const [a] = await first<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    const [b] = await second<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    await control`BEGIN`;
    await control`SELECT id FROM workspaces WHERE id=${ws!.id} FOR UPDATE`;
    const one = service(first).process('paddle', refund('txn_sweep'), {});
    const pending: Promise<unknown>[] = [one];
    try {
      await waitForBlocked(a!.pid);
      const sweepDb = drizzle(second, { schema }) as unknown as DrizzleDb;
      pending.push(runBillingReconciliationSweep(sweepDb, new AutopilotReadService(sweepDb)));
      await waitForBlocked(b!.pid);
    } finally {
      await control`COMMIT`;
    }
    await Promise.all(pending);
    expect(
      (await fixture.select().from(workspaces).where(eq(workspaces.id, ws!.id)))[0]!.tier,
    ).toBe('free');
  });
  it('a new purchase cannot commit a grant ahead of an in-flight workspace projection', async () => {
    const fixture = drizzle(control, { schema });
    const [ws] = await fixture
      .insert(workspaces)
      .values({ name: 'Fresh purchase race' })
      .returning();
    await fixture
      .insert(users)
      .values({ workspaceId: ws!.id, email: 'fresh-' + ws!.id + '@example.test' });
    const [a] = await first<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    await control`BEGIN`;
    await control`SELECT id FROM workspaces WHERE id=${ws!.id} FOR UPDATE`;
    const pending = service(first).process(
      'paddle',
      {
        kind: 'payment',
        outcome: 'succeeded',
        providerSubscriptionId: null,
        providerCustomerId: null,
        workspaceId: ws!.id,
        providerTransactionId: 'txn_new_purchase',
        oneTimePriceIds: ['pri_concurrency_pass'],
        providerEventId: 'evt_new_purchase',
        eventType: 'transaction.completed',
      },
      {},
    );
    try {
      await waitForBlocked(a!.pid);
      // A distinct physical connection sees only committed facts.
      expect(
        await drizzle(second, { schema })
          .select()
          .from(entitlementGrants)
          .where(eq(entitlementGrants.providerTransactionId, 'txn_new_purchase')),
      ).toHaveLength(0);
    } finally {
      await control`COMMIT`;
      await pending;
    }
    expect(
      (await fixture.select().from(workspaces).where(eq(workspaces.id, ws!.id)))[0]!.tier,
    ).toBe('plus');
  });
});
