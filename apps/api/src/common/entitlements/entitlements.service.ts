import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, inArray, ne, sql } from 'drizzle-orm';

import { actionJobs, mailboxAccounts, workspaces } from '@declutrmail/db';
import { ACTION_REGISTRY } from '@declutrmail/shared/actions';
import {
  cleanupActionsLifetimeFor,
  hasCapability,
  inboxLimitFor,
  type Capability,
  type TierId,
} from '@declutrmail/shared/entitlements';
import { COMPOSITE_PRIMARY_VERBS, ERROR_CODES } from '@declutrmail/shared/contracts';

import { DRIZZLE, type DrizzleDb } from '../../db/db.module.js';
import { AppException } from '../app-exception.js';

/**
 * Verbs that draw down the Free lifetime cleanup quota (D19/D77).
 * Derived from the Action Registry — the manifest's `countsAsCleanup`
 * flag on the single-sender selector is the source of truth, so adding
 * a counting verb is a registry edit, never an edit here. Today this
 * resolves to `archive | later | delete` (the label-modify pipeline).
 */
const CLEANUP_VERBS = COMPOSITE_PRIMARY_VERBS.filter(
  (verb) => ACTION_REGISTRY[verb].capabilities.sender.countsAsCleanup,
);

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
 * manifest resolvers and enforces the two launch entitlements:
 *
 *   1. FREE CLEANUP CAP — 5 LIFETIME cleanup actions (D19; supersedes
 *      the old 25/day display path). See `cleanupUnitsUsed` for the
 *      counting rule.
 *   2. INBOX LIMIT — connected-Gmail-account ceiling per tier (D19:
 *      Free 1 / Plus 1 / Pro 2). See `assertCanConnectMailbox`.
 *
 * Both gates throw `AppException` with a 402 + a registered error code
 * (`FREE_CAP_REACHED` / `INBOX_LIMIT_REACHED`) so the FE can branch on
 * the code and render the upgrade prompt.
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
  ): Promise<{ workspaceId: string; tier: TierId } | null> {
    const [row] = await this.db
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
   *   - Keep-intent + policy writes are EXEMPT — they never produce a
   *     counting `action_jobs` row (keep writes none; the unsubscribe
   *     INTENT row's verb is 'unsubscribe', not in `CLEANUP_VERBS` —
   *     the decision record is a policy write; its "also act on past
   *     emails" backlog enqueues as its own composite and counts there).
   *   - UNDO DOES NOT REFUND — reverse rows (`direction='reverse'`)
   *     are excluded, and the forward row persists after an undo, so
   *     the derived count never decrements.
   *   - A `failed` forward row is excluded: an action that never
   *     mutated anything must not consume the taste quota.
   *   - A terminally-`done` forward row that moved ZERO messages
   *     (`affected_count = 0` — e.g. a 365d-delete on a sender with no
   *     aged INBOX mail) is likewise excluded: a no-op consumed no
   *     cleanup. In-flight rows (`queued`/`executing`, whose
   *     `affected_count` is still its 0 default) keep counting — they
   *     represent intent that is about to move mail.
   *
   * Derivation is purely from existing `action_jobs` data (no schema
   * change): group id = `COALESCE(composite_id, id)`, sender unit =
   * the selector's `senderId` (rows with a messages selector fall back
   * to their own id — each is its own unit). The scan walks the
   * workspace's mailboxes via `action_jobs_account_status_created_idx`
   * (leading column `mailbox_account_id`).
   */
  async cleanupUnitsUsed(workspaceId: string): Promise<number> {
    const [row] = await this.db
      .select({
        used: sql<number>`count(DISTINCT (COALESCE(${actionJobs.compositeId}, ${actionJobs.id}), COALESCE(${actionJobs.selector}->>'senderId', ${actionJobs.id}::text)))::int`,
      })
      .from(actionJobs)
      .innerJoin(mailboxAccounts, eq(mailboxAccounts.id, actionJobs.mailboxAccountId))
      .where(
        and(
          eq(mailboxAccounts.workspaceId, workspaceId),
          eq(actionJobs.direction, 'forward'),
          inArray(actionJobs.verb, CLEANUP_VERBS),
          ne(actionJobs.status, 'failed'),
          // A no-op (terminally done, moved nothing) consumes no unit.
          sql`not (${actionJobs.status} = 'done' and ${actionJobs.affectedCount} = 0)`,
        ),
      );
    return row?.used ?? 0;
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
   * 402. Known race (accepted): two DISTINCT rapid clicks at the cap
   * boundary can both pass the read-then-insert window and overshoot
   * by one; the quota is a product gate, not a billing ledger, and the
   * very next enqueue 402s.
   */
  async assertCleanupCapacity(mailboxAccountId: string, unitsNeeded: number): Promise<void> {
    const ws = await this.workspaceForMailbox(mailboxAccountId);
    // No workspace row ⇒ the mailbox is orphaned; ownership guards
    // upstream will reject the request — nothing to gate here.
    if (!ws) return;
    const limit = cleanupActionsLifetimeFor(ws.tier);
    if (limit === null) return; // unlimited tier
    const used = await this.cleanupUnitsUsed(ws.workspaceId);
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
    const limit = inboxLimitFor(tier);
    const [row] = await this.db
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
 * Per-capability upgrade copy for the 402 `PRO_FEATURE_REQUIRED`
 * envelope. Keyed by the D19 manifest capability; a capability without
 * an entry falls back to the error registry's generic line. The
 * `screener` entry is the exact D77 copy `ScreenerService` shipped
 * with — extracting the gate must not reword it.
 */
const CAPABILITY_UPGRADE_MESSAGES: Partial<Record<Capability, string>> = {
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
 * D19/D77 Pro-capability gate — throws 402 `PRO_FEATURE_REQUIRED` when
 * `tier`'s manifest capability set lacks `capability`. Team/enterprise
 * carry the pro set, so the plan's "tier ∈ {pro, team, enterprise}"
 * unlock rule falls out of the manifest, never a hardcoded list.
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
