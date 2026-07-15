import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, inArray, ne, sql } from 'drizzle-orm';

import {
  actionJobs,
  actionVerb,
  mailboxAccounts,
  workspaces,
  type ActionVerb as PersistedActionVerb,
} from '@declutrmail/db';
import { ACTION_REGISTRY, type ActionVerb, type SelectorType } from '@declutrmail/shared/actions';
import {
  cleanupActionsLifetimeFor,
  hasCapability,
  inboxLimitFor,
  satisfiesActionTier,
  type Capability,
  type TierId,
} from '@declutrmail/shared/entitlements';
import { ERROR_CODES } from '@declutrmail/shared/contracts';

import { DRIZZLE, type DrizzleDb } from '../../db/db.module.js';
import { AppException } from '../app-exception.js';

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
}

/** Workspace identity + locked tier used by an inbox activation. */
export interface InboxWorkspace {
  workspaceId: string;
  tier: TierId;
}

/**
 * Verbs that draw down the Free lifetime cleanup quota (D19/D77).
 * Derived from the Action Registry — the manifest's `countsAsCleanup`
 * flag on the single-sender selector is the source of truth, so adding
 * a counting verb is a registry edit, never an edit here. Today this
 * resolves to `archive | later | delete | unsubscribe`. The DB enum is
 * a narrower append-only subset of the registry, so the final filter
 * keeps only verbs that can actually appear in `action_jobs`.
 */
const PERSISTED_ACTION_VERBS = new Set<string>(actionVerb.enumValues);
const CLEANUP_VERBS = Object.values(ACTION_REGISTRY)
  .filter((descriptor) => descriptor.capabilities.sender.countsAsCleanup)
  .map((descriptor) => descriptor.verb)
  .filter((verb): verb is PersistedActionVerb => PERSISTED_ACTION_VERBS.has(verb));

/** One workspace's cleanup-quota position (D19 Free = 5 lifetime). */
export interface CleanupSummary {
  tier: TierId;
  /** Manifest lifetime quota — `null` = unlimited (every paid tier). */
  limit: number | null;
  /** Lifetime cleanup units consumed (0 when unlimited — not computed). */
  used: number;
  /** `limit - used`, floored at 0; `null` when unlimited. */
  remaining: number | null;
}

/**
 * EntitlementsService (D19, D77, D81) — server-side tier enforcement.
 *
 * Reads `workspaces.tier` + the `@declutrmail/shared/entitlements`
 * manifest resolvers and enforces the launch entitlements:
 *
 *   1. FREE CLEANUP CAP — 5 LIFETIME cleanup actions (D19; supersedes
 *      the old 25/day display path). See `cleanupUnitsUsed` for the
 *      counting rule.
 *   2. ACTION SELECTOR TIER — Free single-sender, Plus explicit bulk,
 *      Pro all-matching, sourced from the Action Registry.
 *   3. INBOX LIMIT — connected-Gmail-account ceiling per tier (D19:
 *      Free 1 / Plus 1 / Pro 2). See `assertCanConnectMailbox`.
 *
 * Gates throw `AppException` with a 402 + a registered error code so
 * the FE can branch on the code and render the upgrade prompt.
 */
@Injectable()
export class EntitlementsService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

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
      .select({ workspaceId: workspaces.id, tier: workspaces.tier })
      .from(mailboxAccounts)
      .innerJoin(workspaces, eq(workspaces.id, mailboxAccounts.workspaceId))
      .where(eq(mailboxAccounts.id, mailboxAccountId))
      .limit(1);
    return row ?? null;
  }

  /**
   * Lifetime cleanup units consumed by a workspace (D19 Free cap).
   *
   * COUNTING RULE (the single place it is defined — cite, don't copy):
   *
   *   One cleanup unit per SENDER per enqueue whose verb's manifest
   *   entry has `countsAsCleanup: true` (`CLEANUP_VERBS` above).
   *
   *   - A composite (primary + secondary on one sender, one click) is
   *     ONE unit — the secondary row shares the primary's group via
   *     `composite_id`.
   *   - A bulk of N senders is N units — every row shares the anchor's
   *     group but each sender is its own `(group, sender)` pair.
   *   - Keep is EXEMPT — it produces no `action_jobs` row. A fresh
   *     unsubscribe intent IS one cleanup unit: only its durable dedup
   *     row (`verb='unsubscribe'`, key `unsub:*`) counts. The optional
   *     one-click execution row (`unsubexec-*`) is bookkeeping for the
   *     same decision and never consumes a second unit. An optional
   *     "also act on past emails" composite is a separate cleanup click.
   *   - UNDO DOES NOT REFUND — reverse rows (`direction='reverse'`)
   *     are excluded, and the forward row persists after an undo, so
   *     the derived count never decrements.
   *   - A `failed` forward row is excluded: an action that never
   *     mutated anything must not consume the taste quota.
   *   - Recovery attempts share the original action's lineage group,
   *     so recovering one failed click never charges the same user
   *     intent twice.
   *   - A terminally-`done` label-action row that moved ZERO messages
   *     (`affected_count = 0` — e.g. a 365d-delete on a sender with no
   *     aged INBOX mail) is likewise excluded: a no-op consumed no
   *     cleanup. Unsubscribe intent rows are the exception: the durable
   *     decision itself is the cleanup even though it moves no mail.
   *     In-flight rows (`queued`/`executing`, whose
   *     `affected_count` is still its 0 default) keep counting — they
   *     represent intent that is about to move mail.
   *
   * Derivation is purely from existing `action_jobs` data (no schema
   * change): group id = `COALESCE(composite_id, root_action_id, id)`, sender unit =
   * the selector's `senderId` (rows with a messages selector fall back
   * to their own id — each is its own unit). The scan walks the
   * workspace's mailboxes via `action_jobs_account_status_created_idx`
   * (leading column `mailbox_account_id`).
   */
  async cleanupUnitsUsed(
    workspaceId: string,
    executor: EntitlementsExecutor = this.db,
  ): Promise<number> {
    const [row] = await executor
      .select({
        used: sql<number>`count(DISTINCT (COALESCE(${actionJobs.compositeId}, ${actionJobs.rootActionId}, ${actionJobs.id}), COALESCE(${actionJobs.selector}->>'senderId', ${actionJobs.id}::text)))::int`,
      })
      .from(actionJobs)
      .innerJoin(mailboxAccounts, eq(mailboxAccounts.id, actionJobs.mailboxAccountId))
      .where(
        and(
          eq(mailboxAccounts.workspaceId, workspaceId),
          eq(actionJobs.direction, 'forward'),
          inArray(actionJobs.verb, CLEANUP_VERBS),
          // Only the durable intent-dedup row represents the user's
          // unsubscribe cleanup decision. The one-click execution row
          // (`unsubexec-*`) belongs to that same unit.
          sql`(${actionJobs.verb} <> 'unsubscribe' OR ${actionJobs.idempotencyKey} LIKE 'unsub:%')`,
          ne(actionJobs.status, 'failed'),
          // A no-op label action consumes no unit. An unsubscribe intent
          // is a completed cleanup decision despite affected_count=0.
          sql`(${actionJobs.verb} = 'unsubscribe' OR not (${actionJobs.status} = 'done' and ${actionJobs.affectedCount} = 0))`,
        ),
      );
    return row?.used ?? 0;
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
    if (!workspace || cleanupActionsLifetimeFor(workspace.tier) === null) {
      return workspace;
    }

    const [locked] = await executor
      .select({ workspaceId: workspaces.id, tier: workspaces.tier })
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
    const tier = await this.tierForWorkspace(workspaceId);
    const limit = cleanupActionsLifetimeFor(tier);
    if (limit === null) {
      return { tier, limit: null, used: 0, remaining: null };
    }
    const used = await this.cleanupUnitsUsed(workspaceId);
    return { tier, limit, used, remaining: Math.max(0, limit - used) };
  }

  /**
   * Gate a FRESH cleanup enqueue: throws 402 `FREE_CAP_REACHED` when
   * the workspace's lifetime quota cannot cover `unitsNeeded`.
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
  ): Promise<void> {
    // No workspace row ⇒ the mailbox is orphaned; ownership guards
    // upstream will reject the request — nothing to gate here.
    if (!workspace) return;
    const limit = cleanupActionsLifetimeFor(workspace.tier);
    if (limit === null) return; // unlimited tier
    const used = await this.cleanupUnitsUsed(workspace.workspaceId, executor);
    if (used + unitsNeeded > limit) {
      const remaining = Math.max(0, limit - used);
      throw new AppException({
        code: 'FREE_CAP_REACHED',
        message:
          remaining > 0
            ? `This needs ${unitsNeeded} sender actions but only ${remaining} of your ${limit} free ones are left. Upgrade for unlimited actions.`
            : `You've used all ${limit} free sender actions. Upgrade for unlimited actions — everything you've already done stays done.`,
        details: { remaining, limit, used, requiredUnits: unitsNeeded },
      });
    }
  }

  /**
   * Enforce the Action Registry's minimum tier for one verb × selector
   * pair. This is separate from the Free lifetime counter: Free keeps
   * five `sender` cleanup actions, while `multi-sender` starts at Plus
   * and `sender-filter` starts at Pro.
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

    const requiredPlan =
      actionCapability.tier.charAt(0).toUpperCase() + actionCapability.tier.slice(1);
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
   * whenever doing so stays within the limit.
   */
  async assertCanConnectMailbox(workspaceId: string): Promise<void> {
    const tier = await this.tierForWorkspace(workspaceId);
    await this.assertInboxCapacityForWorkspace({ workspaceId, tier });
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
    const limit = inboxLimitFor(tier);
    const [row] = await executor
      .select({ connected: count() })
      .from(mailboxAccounts)
      .where(
        and(eq(mailboxAccounts.workspaceId, workspaceId), eq(mailboxAccounts.status, 'active')),
      );
    const connected = Number(row?.connected ?? 0);
    if (connected >= limit) {
      throw new AppException({
        code: 'INBOX_LIMIT_REACHED',
        message:
          limit === 1
            ? 'Your plan includes 1 connected inbox. Upgrade to Pro to connect a second Gmail account.'
            : `Your plan includes ${limit} connected inboxes and all are in use.`,
        details: { limit, connected, tier },
      });
    }
  }
}

/**
 * Per-capability upgrade copy for the legacy 402 `PRO_FEATURE_REQUIRED`
 * envelope. Keyed by the D19 manifest capability; a capability without
 * an entry falls back to the error registry's generic line. The
 * `screener` entry is the exact D77 copy `ScreenerService` shipped
 * with — extracting the gate must not reword it.
 */
const CAPABILITY_UPGRADE_MESSAGES: Partial<Record<Capability, string>> = {
  triage: 'Triage is part of the Plus plan. Upgrade to review a focused sender queue.',
  screener: 'The Screener is part of the Pro plan. Upgrade to review new senders in one place.',
  autopilot: 'Autopilot is part of the Pro plan. Upgrade to automate your inbox rules.',
  brief: 'The Daily Brief is part of the Pro plan. Upgrade to get your morning inbox summary.',
  quiet: 'Quiet hours are part of the Pro plan. Upgrade to schedule when Autopilot acts.',
  snoozed:
    'The Later list is part of the Pro plan. Upgrade to manage every Later sender in one place.',
  followups:
    'Follow-ups are part of the Pro plan. Upgrade to track threads still waiting on a reply.',
};

/**
 * D19/D77 capability gate — throws 402 `PRO_FEATURE_REQUIRED` when
 * `tier`'s manifest capability set lacks `capability`. Team/enterprise
 * carry the pro set, while Triage starts at Plus. The unlock rule falls
 * out of the manifest, never a hardcoded tier list. The error-code name
 * is retained for wire compatibility; the per-capability message names
 * the actual required plan.
 *
 * A pure function (not a service method) so both DI paths share it
 * without mock churn: `ScreenerService.assertScreenerCapability`
 * (mailbox-resolved tier) and `CapabilityGuard` (principal-resolved
 * tier).
 */
export function assertTierCapability(tier: TierId, capability: Capability): void {
  if (hasCapability(tier, capability)) return;
  throw new AppException({
    code: 'PRO_FEATURE_REQUIRED',
    message: CAPABILITY_UPGRADE_MESSAGES[capability] ?? ERROR_CODES.PRO_FEATURE_REQUIRED.message,
    details: { capability, tier },
  });
}
