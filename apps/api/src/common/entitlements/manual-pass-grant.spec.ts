import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { entitlementGrants, mailboxAccounts, schema, users, workspaces } from '@declutrmail/db';
import { freshTestPglite } from '@declutrmail/db/testing';
import { OFFERS } from '@declutrmail/shared/entitlements';
import type { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';

import type { DrizzleDb } from '../../db/db.module.js';
import { UsersService } from '../../users/users.service.js';
import { AppException } from '../app-exception.js';
import { EntitlementsService } from './entitlements.service.js';
import {
  grantKindLabel,
  grantManualPass,
  hasRevokedProviderPass,
  listGrants,
  parseGrantArgs,
  revokeOperatorGrants,
  type SqlQuery,
} from '../../../../../scripts/grant-tier-ops.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function asSql(pg: PGlite): SqlQuery {
  return (async (strings: TemplateStringsArray, ...values: readonly unknown[]) => {
    let text = '';
    const params: unknown[] = [];
    strings.forEach((chunk, index) => {
      text += chunk;
      if (index < values.length) {
        params.push(values[index]);
        text += `$${params.length}`;
      }
    });
    const result = await pg.query(text, params);
    return result.rows;
  }) as SqlQuery;
}

async function harness() {
  const pg = await freshTestPglite();
  return { pg, sql: asSql(pg), db: drizzle(pg, { schema }) as unknown as DrizzleDb };
}

describe('manual Backlog Pass grants', () => {
  it('requires a reason and refuses a custom expiry', () => {
    expect(parseGrantArgs(['grant-pass', 'a@b.com'])).toEqual({
      ok: false,
      message: '--reason="why this grant exists" is required',
    });
    expect(
      parseGrantArgs(['grant-pass', 'a@b.com', '--reason=support', '--expires=2026-12-31']),
    ).toEqual({
      ok: false,
      message: 'grant-pass uses the Backlog Pass duration; --expires is not accepted',
    });
    const parsed = parseGrantArgs(['grant-pass', 'a@b.com', '--reason=support', '--by=ada']);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.args).toMatchObject({
      command: 'grant-pass',
      email: 'a@b.com',
      tier: 'plus',
      reason: 'support',
      grantedBy: 'ada',
    });
  });

  it('inserts one Plus pass for the manifest duration and does not stack a second', async () => {
    const { sql, db } = await harness();
    const now = new Date('2026-10-13T12:00:00.000Z');
    const first = await grantManualPass(sql, {
      email: 'ada@example.test',
      reason: 'support',
      grantedBy: 'founder',
      now,
      transactionId: 'manual-pass:one',
    });
    expect(first).toEqual({
      status: 'granted',
      expiresAt: new Date(now.getTime() + OFFERS.backlogPass.durationDays * DAY_MS),
      providerTransactionId: 'manual-pass:one',
    });
    expect(OFFERS.backlogPass.durationDays).toBe(30);

    const second = await grantManualPass(sql, {
      email: 'ada@example.test',
      reason: 'again',
      grantedBy: 'founder',
      now: new Date(now.getTime() + DAY_MS),
    });
    expect(second.status).toBe('already_manual');

    const rows = await db.select().from(entitlementGrants);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      email: 'ada@example.test',
      tier: 'plus',
      source: 'pass',
      provider: null,
      providerTransactionId: 'manual-pass:one',
      reason: 'support',
    });

    const listed = await listGrants(sql);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ source: 'pass', provider: null, live: true, tier: 'plus' });
    expect(grantKindLabel(listed[0]!)).toBe('pass manual');
  });

  it('does not add a manual Pass over a live paid Pass', async () => {
    const { sql, db } = await harness();
    await db.insert(entitlementGrants).values({
      email: 'ada@example.test',
      tier: 'plus',
      reason: 'backlog_pass',
      grantedBy: 'paddle',
      source: 'pass',
      provider: 'paddle',
      providerTransactionId: 'txn_paid',
      expiresAt: new Date(Date.now() + 10 * DAY_MS),
    });
    const result = await grantManualPass(sql, {
      email: 'ada@example.test',
      reason: 'support',
      grantedBy: 'founder',
    });
    expect(result.status).toBe('blocked_paid');
    const rows = await db.select().from(entitlementGrants);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.provider).toBe('paddle');
  });

  it('revokes a manual Pass and a comp, and leaves a paid Pass', async () => {
    const { sql, db } = await harness();
    await grantManualPass(sql, {
      email: 'ada@example.test',
      reason: 'support',
      grantedBy: 'founder',
      transactionId: 'manual-pass:revoke',
    });
    await db.insert(entitlementGrants).values([
      {
        email: 'ada@example.test',
        tier: 'pro',
        reason: 'advisor',
        grantedBy: 'founder',
        source: 'comp',
      },
      {
        email: 'ada@example.test',
        tier: 'plus',
        reason: 'backlog_pass',
        grantedBy: 'paddle',
        source: 'pass',
        provider: 'paddle',
        providerTransactionId: 'txn_keep',
        expiresAt: new Date(Date.now() + 10 * DAY_MS),
      },
    ]);

    const revoked = await revokeOperatorGrants(sql, 'ada@example.test');
    expect(revoked.status).toBe('revoked');
    if (revoked.status !== 'revoked') return;
    expect(revoked.rows.map((row) => row.source).sort()).toEqual(['comp', 'pass']);
    expect(revoked.untouchedPaidPass).toMatchObject({
      provider: 'paddle',
      providerTransactionId: 'txn_keep',
    });

    const rows = await db.select().from(entitlementGrants);
    const manual = rows.find((row) => row.providerTransactionId === 'manual-pass:revoke');
    const comp = rows.find((row) => row.source === 'comp');
    const paid = rows.find((row) => row.providerTransactionId === 'txn_keep');
    expect(manual?.revokedAt).not.toBeNull();
    expect(comp?.revokedAt).not.toBeNull();
    expect(paid?.revokedAt).toBeNull();
    expect(await hasRevokedProviderPass(sql, 'ada@example.test')).toBe(false);
  });

  it('treats only a revoked provider Pass as a prior refund', async () => {
    const { sql, db } = await harness();
    await grantManualPass(sql, {
      email: 'ada@example.test',
      reason: 'support',
      grantedBy: 'founder',
    });
    await revokeOperatorGrants(sql, 'ada@example.test');
    expect(await hasRevokedProviderPass(sql, 'ada@example.test')).toBe(false);

    await db.insert(entitlementGrants).values({
      email: 'ada@example.test',
      tier: 'plus',
      reason: 'backlog_pass',
      grantedBy: 'paddle',
      source: 'pass',
      provider: 'paddle',
      providerTransactionId: 'txn_refunded',
      expiresAt: new Date(Date.now() + DAY_MS),
      revokedAt: new Date(),
    });
    expect(await hasRevokedProviderPass(sql, 'ada@example.test')).toBe(true);
  });

  it('applies a grant written before signup, then caps the workspace at one inbox', async () => {
    const { sql, db } = await harness();
    await grantManualPass(sql, {
      email: 'future@example.test',
      reason: 'invite',
      grantedBy: 'founder',
    });

    const usersService = new UsersService(db);
    const { workspaceId, userId } = await usersService.insertWorkspaceAndUser(
      db,
      'future@example.test',
    );
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    expect(ws?.tier).toBe('plus');

    process.env.PRICING_V2 = 'true';
    try {
      const entitlements = new EntitlementsService(db);
      expect(await entitlements.inboxEntitlementForWorkspace(workspaceId)).toEqual({
        limit: 1,
        reason: 'pass',
      });
      await expect(entitlements.assertCanConnectMailbox(workspaceId)).resolves.toBeUndefined();

      await db.insert(mailboxAccounts).values({
        workspaceId,
        userId,
        provider: 'gmail',
        providerAccountId: 'future@example.test',
      });
      const err = await entitlements
        .assertCanConnectMailbox(workspaceId)
        .catch((error: unknown) => error);
      expect(err).toBeInstanceOf(AppException);
      expect((err as AppException).code).toBe('INBOX_LIMIT_REACHED');
      expect((err as AppException).details).toMatchObject({
        limit: 1,
        connected: 1,
        reason: 'pass',
      });
    } finally {
      delete process.env.PRICING_V2;
    }

    const grants = await db.select().from(entitlementGrants);
    expect(grants).toHaveLength(1);
    expect(grants[0]?.provider).toBeNull();
    const [user] = await db.select().from(users).where(eq(users.email, 'future@example.test'));
    expect(user?.id).toBe(userId);
  });

  it('does not reference a payment provider from the grant command', () => {
    const ops = readFileSync(
      fileURLToPath(new URL('../../../../../scripts/grant-tier-ops.ts', import.meta.url)),
      'utf8',
    );
    const cli = readFileSync(
      fileURLToPath(new URL('../../../../../scripts/grant-tier.ts', import.meta.url)),
      'utf8',
    );
    expect(ops).not.toMatch(/paddle\.adapter|PaddleAdapter|api\.paddle|@paddle\//);
    expect(cli).not.toMatch(/paddle\.adapter|PaddleAdapter|api\.paddle|@paddle\//);
  });
});
