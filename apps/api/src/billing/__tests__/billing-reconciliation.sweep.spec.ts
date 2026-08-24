import {
  actionJobs,
  automationRules,
  mailboxAccounts,
  pendingCheckouts,
  ruleMatchLog,
  subscriptions,
  users,
  workspaces,
} from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import {
  hasCapability,
  minimumTierForCapability,
  TIER_IDS,
  type TierId,
} from '@declutrmail/shared/entitlements';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { runBillingReconciliationSweep } from '../billing-reconciliation.sweep.js';
import { AutopilotReadService } from '../../autopilot/autopilot.read-service.js';
import type { DrizzleDb } from '../../db/db.module.js';

async function freshDb(): Promise<DrizzleDb> {
  return (await freshTestDb()) as unknown as DrizzleDb;
}

async function seedWorkspace(db: DrizzleDb, tier: TierId): Promise<string> {
  const [ws] = await db
    .insert(workspaces)
    .values({ name: 'sweep-test', tier })
    .returning({ id: workspaces.id });
  return ws!.id;
}

describe('runBillingReconciliationSweep', () => {
  let db: DrizzleDb;
  let autopilot: AutopilotReadService;

  beforeEach(async () => {
    db = await freshDb();
    // Queue-less, like the worker composition root — the sweep only
    // needs the D251 demotion facade.
    autopilot = new AutopilotReadService(db as never);
  });

  it('drops a STALE refund entitlement — no recency bound (Codex stop-review 2026-07-29)', async () => {
    // The regression: an ACTIVE row carrying a refund verdict written
    // long ago, whose entitlement deadline passed last week, and whose
    // updated_at is 40 days old. The first sweep version bounded the
    // recompute to rows updated in the last 30 days — this exact row
    // slipped through and the workspace kept pro forever.
    const wsId = await seedWorkspace(db, 'pro');
    await db.insert(subscriptions).values({
      workspaceId: wsId,
      provider: 'paddle',
      providerSubscriptionId: 'sub_stale_refund',
      tier: 'pro',
      status: 'active',
      providerPriceId: 'pri_x',
      billingCycle: 'monthly',
      cancelSource: 'refund',
      entitlementEndsAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      updatedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
    });

    const result = await runBillingReconciliationSweep(db, autopilot);

    expect(result.workspacesRecomputed).toBe(1);
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, wsId));
    expect(ws!.tier).toBe('free');
    // Refund rows keep their provider status — only the TIER drops;
    // status is the provider's to change.
    const [row] = await db.select().from(subscriptions);
    expect(row!.status).toBe('active');
  });

  it('flips expired-dunning past_due rows to canceled and recomputes', async () => {
    const wsId = await seedWorkspace(db, 'plus');
    await db.insert(subscriptions).values({
      workspaceId: wsId,
      provider: 'razorpay',
      providerSubscriptionId: 'sub_dunning',
      tier: 'plus',
      status: 'past_due',
      providerPriceId: 'pri_y',
      billingCycle: 'monthly',
      entitlementEndsAt: new Date(Date.now() - 60 * 1000),
    });

    const result = await runBillingReconciliationSweep(db, autopilot);

    expect(result.dunningFlipped).toBe(1);
    const [row] = await db.select().from(subscriptions);
    expect(row!.status).toBe('canceled');
    expect(row!.cancelSource).toBe('provider');
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, wsId));
    expect(ws!.tier).toBe('free');
  });

  it('leaves healthy rows and future deadlines alone', async () => {
    const wsId = await seedWorkspace(db, 'pro');
    await db.insert(subscriptions).values({
      workspaceId: wsId,
      provider: 'paddle',
      providerSubscriptionId: 'sub_healthy',
      tier: 'pro',
      status: 'active',
      providerPriceId: 'pri_z',
      billingCycle: 'annual',
    });
    await db.insert(subscriptions).values({
      workspaceId: wsId,
      provider: 'paddle',
      providerSubscriptionId: 'sub_future_dunning',
      tier: 'pro',
      status: 'paused',
      providerPriceId: 'pri_z2',
      billingCycle: 'monthly',
      entitlementEndsAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
    });

    const result = await runBillingReconciliationSweep(db, autopilot);
    expect(result.dunningFlipped).toBe(0);
    expect(result.workspacesRecomputed).toBe(0);
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, wsId));
    expect(ws!.tier).toBe('pro');
  });

  it('clears claims expired >7 days; RETAINS freshly-expired ones (stale-lock reconciliation)', async () => {
    // D249 (Codex 2026-07-30): a freshly-expired claim is no longer
    // deleted — its provider_ref is the only exact link a stale
    // browser lock has to a still-payable Razorpay artifact. Expiry
    // already re-arms checkout via the claim upsert; deletion is pure
    // housekeeping and can wait 7 days.
    const wsOld = await seedWorkspace(db, 'free');
    const wsFresh = await seedWorkspace(db, 'free');
    const wsLive = await seedWorkspace(db, 'free');
    await db.insert(pendingCheckouts).values([
      {
        workspaceId: wsOld,
        provider: 'paddle',
        tier: 'pro',
        billingCycle: 'annual',
        expiresAt: new Date(Date.now() - 8 * 24 * 3600 * 1000),
      },
      {
        workspaceId: wsFresh,
        provider: 'razorpay',
        tier: 'plus',
        billingCycle: 'monthly',
        providerRef: 'sub_stale_lock_link',
        expiresAt: new Date(Date.now() - 1000),
      },
      {
        workspaceId: wsLive,
        provider: 'razorpay',
        tier: 'plus',
        billingCycle: 'monthly',
        expiresAt: new Date(Date.now() + 60_000),
      },
    ]);

    const result = await runBillingReconciliationSweep(db, autopilot);
    expect(result.pendingCheckoutsCleared).toBe(1);
    const remaining = await db.select().from(pendingCheckouts);
    expect(remaining.map((r) => r.workspaceId).sort()).toEqual([wsFresh, wsLive].sort());
    // The retained expired row still carries the reconciliation link.
    expect(remaining.find((r) => r.workspaceId === wsFresh)!.providerRef).toBe(
      'sub_stale_lock_link',
    );
  });

  it('demotes active rules + neutralizes unattended matches on under-entitled tiers ONLY', async () => {
    // Both sides DERIVED from the manifest. This test used to hardcode
    // plus-vs-pro; when `autopilot-active` moved to Plus (2026-08-23)
    // the "under-entitled" side became entitled and the test asserted
    // a demotion that correctly no longer happens.
    const under = TIER_IDS.find((t) => !hasCapability(t, 'autopilot-active'))!;
    const entitled = minimumTierForCapability('autopilot-active');

    async function seedAutomation(tier: TierId): Promise<{
      ruleId: string;
      matchId: string;
      claimedMatchId: string;
      mailboxId: string;
    }> {
      const wsId = await seedWorkspace(db, tier);
      const [user] = await db
        .insert(users)
        .values({ workspaceId: wsId, email: `${tier}-sweep@example.test` })
        .returning({ id: users.id });
      const [mb] = await db
        .insert(mailboxAccounts)
        .values({
          workspaceId: wsId,
          userId: user!.id,
          provider: 'gmail',
          providerAccountId: `${tier}-sweep@example.test`,
        })
        .returning({ id: mailboxAccounts.id });
      const [rule] = await db
        .insert(automationRules)
        .values({
          mailboxAccountId: mb!.id,
          isPreset: true,
          presetKey: 'auto_archive_low_engagement',
          name: 'Archive low engagement',
          enabled: true,
          mode: 'active',
          scope: 'account',
          conditions: {},
          actionKind: 'archive',
          actionPayload: {},
        })
        .returning({ id: automationRules.id });
      const insertMatch = (senderKey: string) =>
        db
          .insert(ruleMatchLog)
          .values({
            ruleId: rule!.id,
            mailboxAccountId: mb!.id,
            senderKey,
            modeAtMatch: 'active',
            confidence: '0.90',
            reason: 'sweep fixture',
            resolution: 'approved',
            intentApplied: false,
          })
          .returning({ id: ruleMatchLog.id })
          .then((r) => r[0]!.id);
      const matchId = await insertMatch('a'.repeat(64));
      const claimedMatchId = await insertMatch('b'.repeat(64));
      // In-flight claim — mirrors the action worker's `claimKey`.
      await db.insert(actionJobs).values({
        mailboxAccountId: mb!.id,
        verb: 'archive',
        selector: { type: 'messages' },
        idempotencyKey: `autopilot-${claimedMatchId}`,
        status: 'executing',
      });
      return { ruleId: rule!.id, matchId, claimedMatchId, mailboxId: mb!.id };
    }

    // Identical state on both sides of the entitlement line: the
    // under-entitled workspace must converge, the entitled one must NOT
    // be touched — that grant-side row is what keeps the tier predicate
    // from passing vacuously.
    const plus = await seedAutomation(under);
    const pro = await seedAutomation(entitled);

    const result = await runBillingReconciliationSweep(db, autopilot);

    expect(result.unattendedRulesDemoted).toBe(1);
    expect(result.unattendedMatchesNeutralized).toBe(1);

    const [plusRule] = await db
      .select()
      .from(automationRules)
      .where(eq(automationRules.id, plus.ruleId));
    expect(plusRule!.mode).toBe('observe');
    expect(plusRule!.observePromptDismissedAt).toBeNull();
    const [plusMatch] = await db
      .select()
      .from(ruleMatchLog)
      .where(eq(ruleMatchLog.id, plus.matchId));
    expect(plusMatch!.resolution).toBe('dismissed');
    expect(plusMatch!.dismissReason).toBe('entitlement');
    // The claimed match completes through the worker, never relabelled.
    const [plusClaimed] = await db
      .select()
      .from(ruleMatchLog)
      .where(eq(ruleMatchLog.id, plus.claimedMatchId));
    expect(plusClaimed!.resolution).toBe('approved');

    const [proRule] = await db
      .select()
      .from(automationRules)
      .where(eq(automationRules.id, pro.ruleId));
    expect(proRule!.mode).toBe('active');
    const [proMatch] = await db.select().from(ruleMatchLog).where(eq(ruleMatchLog.id, pro.matchId));
    expect(proMatch!.resolution).toBe('approved');

    // Second sweep is a no-op — the demote is idempotent.
    const again = await runBillingReconciliationSweep(db, autopilot);
    expect(again.unattendedRulesDemoted).toBe(0);
    expect(again.unattendedMatchesNeutralized).toBe(0);
  });
});
