import { Inject, Injectable, Optional } from '@nestjs/common';
import { alias } from 'drizzle-orm/pg-core';
import { and, count, eq, gte, sql } from 'drizzle-orm';

import { actionJobs, mailboxAccounts, workspaces } from '@declutrmail/db';
import { ACTION_REGISTRY, type ActionVerb, type SelectorType } from '@declutrmail/shared/actions';
import {
  TIER_MANIFEST,
  hasCapability,
  METER,
  inboxLimitReachedMessage,
  passSecondAccountMessage,
  quotaExceededMessage,
  suggestedWindowPreset,
  minimumTierForCapability,
  satisfiesActionTier,
  type Capability,
  type TierId,
} from '@declutrmail/shared/entitlements';
import { ERROR_CODES } from '@declutrmail/shared/contracts';

import type { ProductEventsPort } from '@declutrmail/shared/analytics/product-events';

import { earliestWorkspaceUserId } from '../../analytics/earliest-workspace-user.js';
import { PRODUCT_EVENTS, recordProductEvent } from '../../analytics/product-events.port.js';
import { DRIZZLE, type DrizzleDb } from '../../db/db.module.js';
import { AppException } from '../app-exception.js';
import { cleanupPeriodFor } from './cleanup-period.js';
import { inboxEntitlementForWorkspace as resolveInboxEntitlement } from './entitlement-grants.js';

/**
 * Either the root Drizzle client or a caller-owned transaction.
 *
 * Cleanup writers pass their transaction so the workspace row lock,
 * quota count, and consuming action-job insert share one atomic unit.
 */
export type EntitlementsTransaction = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0];
export type EntitlementsExecutor = DrizzleDb | EntitlementsTransaction;

/** Workspace identity + tier observed by an entitlement lookup or lock. */
export interface CleanupWorkspace {
  workspaceId: string;
  tier: TierId;
  /** The signup instant — the anchor for the monthly quota period (A3). */
  createdAt: Date;
}

/** Workspace identity + locked tier used by an inbox activation. */
export interface InboxWorkspace {
  workspaceId: string;
  tier: TierId;
}

/** Monthly email allowance: `METER` on Free, unlimited (`null`) on paid tiers. */
function meterLimitFor(tier: TierId): number | null {
  return tier === 'free' ? METER.free.limit : null;
}

/**
 * Coerce `cleanupUnitsUsed`'s raw row value to a real number.
 *
 * `used` is correct today only because the sql fragment it decodes ends
 * in `::int` — postgres.js has no default parser for a bare bigint
 * (OID 20), so a dropped cast would silently hand this a string, and
 * `used + unitsNeeded > limit` would become a string comparison
 * (QA-triage-20260827-04: a Free user 402'd at 6 of 50 actions). A
 * dedicated function so the coercion is unit-testable independently of
 * whether `::int` is present in the query today.
 */
export function coerceUsedCount(raw: number | string | null | undefined): number {
  return Number(raw ?? 0);
}

/** One workspace's meter position (Free = `METER.free.limit` emails a period). */
export interface CleanupSummary {
  tier: TierId;
  /** Config allowance — `null` = unlimited (every paid tier). */
  limit: number | null;
  /** Emails held THIS period (0 when unlimited — not computed). */
  used: number;
  /** `limit - used`, floored at 0; `null` when unlimited. */
  remaining: number | null;
  /**
   * The next anniversary reset instant — server-computed, mandatory on
   * the wire (the browser must never derive it). `null` = unlimited.
   */
  resetsAt: Date | null;
}

/**
 * EntitlementsService (D19, D77, D81) — server-side tier enforcement.
 *
 * Reads `workspaces.tier` + the `@declutrmail/shared/entitlements`
 * manifest resolvers and enforces the launch entitlements:
 *
 *   1. FREE METER — `METER.free.limit` emails cleared per signup-month
 *      period. See `cleanupUnitsUsed` for the counting rule and
 *      `cleanupPeriodFor` for the period.
 *   2. ACTION SELECTOR TIER — single-sender and explicit bulk are Free,
 *      all-matching starts at Pro (A3), sourced from the pricing config
 *      through the Action Registry.
 *   3. INBOX LIMIT — connected-Gmail-account ceiling per tier (D19/A3;
 *      `INBOXES`). A Pass-only workspace (live
 *      `source='pass'` grant, no granting paid Plus/Pro) stays at 1.
 *      See `assertCanConnectMailbox`.
 *
 * Gates throw `AppException` with a 402 + a registered error code so
 * the FE can branch on the code and render the upgrade prompt.
 */
@Injectable()
export class EntitlementsService {
  private readonly productEvents: ProductEventsPort;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    @Optional() @Inject(PRODUCT_EVENTS) productEvents?: ProductEventsPort,
  ) {
    this.productEvents = productEvents ?? {
      record() {
        // No-op when the analytics module is not in the test graph.
      },
    };
  }

  /** The workspace's billing tier; defaults to 'free' if the row is gone. */
  async tierForWorkspace(workspaceId: string): Promise<TierId> {
    const [row] = await this.db
      .select({ tier: workspaces.tier })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    return row?.tier ?? 'free';
  }

  /** Resolve a mailbox's workspace + tier in one indexed join. */
  async workspaceForMailbox(
    mailboxAccountId: string,
    executor: EntitlementsExecutor = this.db,
  ): Promise<CleanupWorkspace | null> {
    const [row] = await executor
      .select({
        workspaceId: workspaces.id,
        tier: workspaces.tier,
        createdAt: workspaces.createdAt,
      })
      .from(mailboxAccounts)
      .innerJoin(workspaces, eq(workspaces.id, mailboxAccounts.workspaceId))
      .where(eq(mailboxAccounts.id, mailboxAccountId))
      .limit(1);
    return row ?? null;
  }

  /**
   * Emails held against Free's meter, scoped to the current signup-month
   * period when `periodStart` is given, lifetime otherwise.
   *
   * COUNTING RULE (the single place it is defined — cite, don't copy):
   * the sum of forward `quota_units` (stamped at enqueue by
   * `quotaUnitsForEnqueue`; only `METER.countsVerbs` verbs on Free stamp
   * any) minus same-period undo restorations. A reverse row refunds only
   * when its forward row was charged in the period being counted. Free
   * actions such as Later, or actions performed on an unlimited tier,
   * cannot refund other usage. A refund never exceeds the forward stamp,
   * even if more emails moved. Floored at 0.
   */
  async cleanupUnitsUsed(
    workspaceId: string,
    executor: EntitlementsExecutor = this.db,
    periodStart?: Date,
  ): Promise<number> {
    const chargedPeriod = periodStart ? [gte(actionJobs.createdAt, periodStart)] : [];
    const [charged] = await executor
      .select({
        used: sql<number>`coalesce(sum(${actionJobs.quotaUnits}), 0)::int`,
      })
      .from(actionJobs)
      .innerJoin(mailboxAccounts, eq(mailboxAccounts.id, actionJobs.mailboxAccountId))
      .where(
        and(
          eq(mailboxAccounts.workspaceId, workspaceId),
          eq(actionJobs.direction, 'forward'),
          ...chargedPeriod,
        ),
      );

    const forward = alias(actionJobs, 'meter_forward');
    const refundPeriod = periodStart ? [gte(forward.createdAt, periodStart)] : [];
    const [restored] = await executor
      .select({
        used: sql<number>`coalesce(sum(least(${actionJobs.affectedCount}, ${forward.quotaUnits})), 0)::int`,
      })
      .from(actionJobs)
      .innerJoin(
        forward,
        and(eq(forward.undoToken, actionJobs.undoToken), eq(forward.direction, 'forward')),
      )
      .innerJoin(mailboxAccounts, eq(mailboxAccounts.id, actionJobs.mailboxAccountId))
      .where(
        and(
          eq(mailboxAccounts.workspaceId, workspaceId),
          eq(actionJobs.direction, 'reverse'),
          eq(actionJobs.status, 'done'),
          ...refundPeriod,
        ),
      );

    return Math.max(0, coerceUsedCount(charged?.used) - coerceUsedCount(restored?.used));
  }

  /**
   * Resolve a mailbox's workspace and serialize finite cleanup quotas.
   *
   * Unlimited tiers return directly after the indexed mailbox lookup;
   * they never take a workspace row lock. A finite tier takes
   * `FOR UPDATE` on its workspace row and returns the tier read by that
   * locking query, rather than trusting the tier observed before the
   * lock was acquired. This matters when billing changes the tier while
   * a cleanup request is waiting for the row.
   *
   * The lock only protects the consuming write when `executor` is a
   * caller-owned transaction that remains open through that write.
   */
  async lockCleanupWorkspace(
    mailboxAccountId: string,
    executor: EntitlementsExecutor = this.db,
  ): Promise<CleanupWorkspace | null> {
    const workspace = await this.workspaceForMailbox(mailboxAccountId, executor);
    if (!workspace || meterLimitFor(workspace.tier) === null) {
      return workspace;
    }

    const [locked] = await executor
      .select({
        workspaceId: workspaces.id,
        tier: workspaces.tier,
        createdAt: workspaces.createdAt,
      })
      .from(workspaces)
      .where(eq(workspaces.id, workspace.workspaceId))
      .for('update')
      .limit(1);
    return locked ?? null;
  }

  /**
   * The workspace's quota position. `used` is only computed when the
   * tier actually has a quota (Free) — paid tiers skip the count scan.
   */
  async cleanupSummary(workspaceId: string): Promise<CleanupSummary> {
    const [row] = await this.db
      .select({ tier: workspaces.tier, createdAt: workspaces.createdAt })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    const tier = row?.tier ?? 'free';
    const limit = meterLimitFor(tier);
    if (limit === null || !row) {
      return { tier, limit: null, used: 0, remaining: null, resetsAt: null };
    }
    const period = cleanupPeriodFor(row.createdAt, new Date());
    const used = await this.cleanupUnitsUsed(workspaceId, this.db, period.periodStart);
    return {
      tier,
      limit,
      used,
      remaining: Math.max(0, limit - used),
      resetsAt: period.resetsAt,
    };
  }

  /**
   * Gate a FRESH cleanup enqueue: throws 402 `FREE_CAP_REACHED` when
   * the workspace's current monthly quota cannot cover `unitsNeeded`.
   *
   * Callers MUST skip this check for an idempotent REPLAY (a request
   * whose `Idempotency-Key` row already exists) — a network-retried
   * click of an action that already consumed its unit must replay, not
   * 402. Fresh cleanup writers must pass their transaction as `executor`
   * and keep it open through the consuming action-job insert. That holds
   * the finite-tier workspace lock across count + write. The default root
   * executor preserves the existing read/check API for non-writing callers,
   * but its statement-scoped lock cannot serialize a later separate write.
   */
  async assertCleanupCapacity(
    mailboxAccountId: string,
    unitsNeeded: number,
    executor: EntitlementsExecutor = this.db,
  ): Promise<void> {
    const workspace = await this.lockCleanupWorkspace(mailboxAccountId, executor);
    await this.assertCleanupCapacityForWorkspace(workspace, unitsNeeded, executor);
  }

  /**
   * Assert capacity against an already-resolved (normally already-locked)
   * workspace. Cleanup writers use this after acquiring the lock and then
   * rechecking idempotency, avoiding a second workspace lookup/lock query.
   */
  async assertCleanupCapacityForWorkspace(
    workspace: CleanupWorkspace | null,
    unitsNeeded: number,
    executor: EntitlementsExecutor = this.db,
    presetCounts?: Partial<Record<number, number>>,
  ): Promise<void> {
    // No workspace row ⇒ the mailbox is orphaned; ownership guards
    // upstream will reject the request — nothing to gate here.
    if (!workspace) return;
    // Unsubscribe, Keep, Later, Undo, preview and scan draw nothing.
    if (unitsNeeded <= 0) return;
    const limit = meterLimitFor(workspace.tier);
    if (limit === null) return; // unlimited tier
    const period = cleanupPeriodFor(workspace.createdAt, new Date());
    const used = await this.cleanupUnitsUsed(workspace.workspaceId, executor, period.periodStart);
    if (used + unitsNeeded > limit) {
      const remaining = Math.max(0, limit - used);
      const resetsAt = period.resetsAt.toISOString();
      const userId = await earliestWorkspaceUserId(executor, workspace.workspaceId);
      recordProductEvent(
        this.productEvents,
        'free_cap_hit',
        { requested_bucket: requestedBucket(unitsNeeded) },
        userId,
      );
      throw new AppException({
        code: 'FREE_CAP_REACHED',
        message: quotaExceededMessage({
          used,
          limit,
          resetAt: resetsAt,
          requested: unitsNeeded,
        }),
        details: {
          remaining,
          limit,
          used,
          requiredUnits: unitsNeeded,
          resetsAt,
          requested: unitsNeeded,
          suggestedPreset: presetCounts ? suggestedWindowPreset(remaining, presetCounts) : null,
        },
      });
    }
  }

  /**
   * Enforce the Action Registry's minimum tier for one verb × selector
   * pair. This is separate from the Free monthly counter: individual
   * and multi-sender cleanup are available on Free; `sender-filter`
   * starts at Pro. Limits come from the entitlement manifest.
   *
   * The registry is the source of truth for both the required tier and
   * whether a selector is supported. Call this at the API/service choke
   * point before resolving sender ids so an under-tier request cannot
   * use a forged payload to probe selection data.
   */
  async assertActionSelectorTier(
    mailboxAccountId: string,
    verb: ActionVerb,
    selector: SelectorType,
  ): Promise<void> {
    const descriptor = ACTION_REGISTRY[verb];
    const actionCapability = descriptor.capabilities[selector];
    if (actionCapability === null) {
      throw new AppException({
        code: 'BAD_REQUEST',
        message: `${descriptor.copy.primary} does not support the ${selector} selector.`,
        details: { verb, selector },
      });
    }

    const ws = await this.workspaceForMailbox(mailboxAccountId);
    // Orphaned/unowned mailboxes are rejected by the ownership guards;
    // this entitlement service does not turn that condition into a 402.
    if (!ws || satisfiesActionTier(ws.tier, actionCapability.tier)) return;

    const requiredPlan = TIER_MANIFEST[actionCapability.tier].name;
    const selectorLabel =
      selector === 'multi-sender'
        ? 'Multi-sender actions'
        : selector === 'sender-filter'
          ? 'All-matching actions'
          : `${descriptor.copy.primary} actions`;
    throw new AppException({
      code: 'ACTION_TIER_REQUIRED',
      message: `${selectorLabel} require the ${requiredPlan} plan. Select one sender or upgrade to continue.`,
      details: {
        tier: ws.tier,
        requiredTier: actionCapability.tier,
        selector,
        verb,
      },
    });
  }

  /**
   * Gate ADDING a Gmail connection (D19 inbox limit): throws 402
   * `INBOX_LIMIT_REACHED` when the workspace already has `inboxLimit`
   * CONNECTED (status='active') mailboxes.
   *
   * Enforcement is on ADDING only — existing connections keep working
   * even if a downgrade leaves the workspace over-limit, and counting
   * `active` rows means a disconnected mailbox can be reconnected
   * whenever doing so stays within the limit. A Pass-only workspace
   * is capped at one new connection; already-connected extras stay.
   */
  async assertCanConnectMailbox(workspaceId: string): Promise<void> {
    const tier = await this.tierForWorkspace(workspaceId);
    await this.assertInboxCapacityForWorkspace({ workspaceId, tier });
  }

  /**
   * Server-computed inbox ceiling for `/api/auth/me` and the connect
   * guard. Derived from the live grant + paid subscription, not the
   * cached `workspaces.tier` (an expired Pass can leave that column
   * at Plus until the grant-ageing sweep).
   */
  async inboxLimitForWorkspace(
    workspaceId: string,
    executor: EntitlementsExecutor = this.db,
    knownTier?: TierId,
  ): Promise<number> {
    return (await this.inboxEntitlementForWorkspace(workspaceId, executor, knownTier)).limit;
  }

  /**
   * Ceiling plus the closed reason the client uses to pick Pass copy.
   * `reason` is `'pass'` only while a live Pass (and no paid Plus/Pro)
   * is what set the one-account limit.
   */
  async inboxEntitlementForWorkspace(
    workspaceId: string,
    executor: EntitlementsExecutor = this.db,
    knownTier?: TierId,
  ): Promise<{ limit: number; reason?: 'pass' }> {
    const storedTier = knownTier ?? (await this.tierForWorkspace(workspaceId));
    return resolveInboxEntitlement(executor, workspaceId, storedTier);
  }

  private async resolveInboxLimit(
    workspace: InboxWorkspace,
    executor: EntitlementsExecutor,
  ): Promise<{ limit: number; reason?: 'pass' }> {
    return resolveInboxEntitlement(executor, workspace.workspaceId, workspace.tier);
  }

  /**
   * Serialize inbox activations on the tenant row and read the tier that
   * actually won that lock. Callers must keep the transaction open through
   * the mailbox activation that consumes the slot.
   */
  async lockInboxWorkspace(
    workspaceId: string,
    executor: EntitlementsTransaction,
  ): Promise<InboxWorkspace | null> {
    const [workspace] = await executor
      .select({ workspaceId: workspaces.id, tier: workspaces.tier })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .for('update')
      .limit(1);
    return workspace ?? null;
  }

  /**
   * Assert capacity using a caller-resolved workspace and executor. The
   * authoritative activation path passes the same transaction that holds
   * `lockInboxWorkspace`; the root executor remains useful for OAuth-start
   * fast-fails where a later transactional recheck is still required.
   */
  async assertInboxCapacityForWorkspace(
    workspace: InboxWorkspace,
    executor: EntitlementsExecutor = this.db,
  ): Promise<void> {
    const { workspaceId, tier } = workspace;
    const { limit, reason } = await this.resolveInboxLimit(workspace, executor);
    const [row] = await executor
      .select({ connected: count() })
      .from(mailboxAccounts)
      .where(
        and(eq(mailboxAccounts.workspaceId, workspaceId), eq(mailboxAccounts.status, 'active')),
      );
    const connected = Number(row?.connected ?? 0);
    if (connected >= limit) {
      const copyTier: TierId = limit === 1 ? 'free' : tier;
      throw new AppException({
        code: 'INBOX_LIMIT_REACHED',
        message:
          reason === 'pass' ? passSecondAccountMessage() : inboxLimitReachedMessage(copyTier),
        details: { limit, connected, tier, ...(reason ? { reason } : {}) },
      });
    }
  }
}

/**
 * Per-capability upgrade copy templates for the 402
 * `PRO_FEATURE_REQUIRED` envelope. The PLAN NAME is never written here
 * — it interpolates from `minimumTierForCapability` + the pricing
 * config, so moving a capability between tiers updates its upgrade copy
 * automatically. A capability without an entry falls back to the error
 * registry's generic line. Triage and the Later apparatus carry no
 * entry because nothing gates them after A3 (they are Free).
 */
const CAPABILITY_FEATURE_COPY: Partial<
  Record<Capability, { subject: string; verb: 'is' | 'are'; pitch: string }>
> = {
  screener: { subject: 'The Screener', verb: 'is', pitch: 'review new senders in one place' },
  // D251 — two entries, because the 402 lands on two different audiences.
  // `autopilot` 402s a FREE workspace probing the surface;
  // `autopilot-active` 402s a PLUS workspace trying mode='active', and telling
  // that user "Autopilot is part of the Pro plan" while they stand on the
  // Autopilot screen would be false — the behaviour is Pro, not the screen.
  autopilot: {
    subject: 'Autopilot',
    verb: 'is',
    pitch: 'let rules find matches for your batch approval',
  },
  'autopilot-active': {
    subject: 'Running rules without per-batch approval',
    verb: 'is',
    pitch: 'let Autopilot act on future matches without asking',
  },
  brief: { subject: 'The Daily Brief', verb: 'is', pitch: 'get your morning inbox summary' },
  quiet: { subject: 'Quiet hours', verb: 'are', pitch: 'schedule when Autopilot acts' },
  followups: {
    subject: 'Follow-ups',
    verb: 'are',
    pitch: 'track threads still waiting on a reply',
  },
};

function capabilityUpgradeMessage(capability: Capability): string {
  const copy = CAPABILITY_FEATURE_COPY[capability];
  if (!copy) return ERROR_CODES.PRO_FEATURE_REQUIRED.message;
  const plan = TIER_MANIFEST[minimumTierForCapability(capability)].name;
  return `${copy.subject} ${copy.verb} part of the ${plan} plan. Upgrade to ${copy.pitch}.`;
}

/**
 * D19/D77 capability gate — throws 402 `PRO_FEATURE_REQUIRED` when
 * `tier`'s manifest capability set lacks `capability`. Team/enterprise
 * carry the pro set; Triage is Free (A3). The unlock rule falls
 * out of the manifest, never a hardcoded tier list. The error-code name
 * is retained for wire compatibility; the per-capability message names
 * the actual required plan.
 *
 * A pure function (not a service method) so both DI paths share it
 * without mock churn: `ScreenerService.assertScreenerCapability`
 * (mailbox-resolved tier) and `CapabilityGuard` (principal-resolved
 * tier).
 */
/** Coarse size of a refused cleanup, so the funnel event does not carry the raw count. */
export function requestedBucket(units: number): string {
  if (!Number.isFinite(units) || units <= 1) return '1';
  if (units <= 10) return '2-10';
  if (units <= 100) return '11-100';
  if (units <= 1000) return '101-1000';
  return '1001+';
}

export function assertTierCapability(tier: TierId, capability: Capability): void {
  if (hasCapability(tier, capability)) return;
  throw new AppException({
    code: 'PRO_FEATURE_REQUIRED',
    message: capabilityUpgradeMessage(capability),
    details: { capability, tier },
  });
}
