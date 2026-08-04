import { sql } from 'drizzle-orm';

import { TIER_IDS, hasCapability } from '@declutrmail/shared/entitlements';

import type { DrizzleDb } from '../db/db.module.js';

/**
 * Billing reconciliation sweep (0051; founder decisions 1+2,
 * 2026-07-28). The webhook is the only billing channel and it can drop
 * — this sweep is the backstop that keeps entitlement honest without
 * one. Runs from the worker composition root (6h + boot); extracted
 * here so the SQL is unit-testable against PGlite — the first version
 * lived inline in worker.ts and shipped an untested `updated_at`
 * recency bound that silently retained expired entitlements (Codex
 * stop-review, 2026-07-29).
 *
 *   1. DUNNING EXPIRY — a `past_due` row whose 14-day deadline passed
 *      flips to canceled (provenance kept; 'provider' when none).
 *   2. TIER RECOMPUTE for every workspace holding a granting-status row
 *      with an expired deadline. NO recency bound: a refund verdict
 *      written months ago whose period ended last week must still drop
 *      — recompute is idempotent and the row set is small, so
 *      re-running for the same workspace every sweep until the
 *      provider's own cancel arrives is the correct cost. The SQL
 *      mirrors BillingWebhookService.recomputeWorkspaceTier — same
 *      statuses, same deadline predicate, same max-rank rule; a drift
 *      between the two IS a bug (cross-referenced in both places).
 *   3. `pending_checkouts` rows expired > 7 days deleted — retention
 *      keeps `provider_ref` reachable for stale-lock reconciliation
 *      (D249); expiry itself re-arms checkout via the claim upsert.
 *   4. Stale D120 scheduled changes (> 7 days) surfaced as WARNs — the
 *      `billing.plan_change_unconfirmed` class only a sweep can age
 *      out.
 *   5. D251 UNATTENDED DEMOTE — any workspace whose CURRENT tier does
 *      not grant `autopilot-active` (list derived from the manifest,
 *      never hardcoded) has `active` rules flipped to `observe` and
 *      unapplied auto-approved matches dismissed. GLOBAL predicate on
 *      purpose, not scoped to workspaces this sweep just recomputed:
 *      the webhook path demotes atomically with its tier write
 *      (BillingWebhookService.recomputeWorkspaceTier → the Autopilot
 *      facade — the SQL here mirrors it; change one, change both), but
 *      an apply sweep already in flight during a downgrade can insert
 *      active-provenance matches AFTER that demotion, and this pass is
 *      the only thing that converges them. Idempotent.
 *
 * Provider-truth polling itself lives NEXT DOOR, not here: the worker
 * runs `BillingReconciliationService.reconcileLiveSubscriptions()`
 * (D249) in the same 6h/boot cadence, fetching provider state for live
 * rows and projecting drift. This file stays pure SQL so it remains
 * unit-testable against PGlite without provider stubs.
 */
export interface BillingSweepResult {
  dunningFlipped: number;
  workspacesRecomputed: number;
  pendingCheckoutsCleared: number;
  staleScheduledChanges: number;
  /** D251 — `active` rules flipped to `observe` on under-entitled tiers. */
  unattendedRulesDemoted: number;
  /** D251 — unapplied auto-approved `active` matches dismissed ('entitlement'). */
  unattendedMatchesNeutralized: number;
}

export async function runBillingReconciliationSweep(db: DrizzleDb): Promise<BillingSweepResult> {
  // RETURNING is load-bearing: the flip converts the row OUT of
  // granting status, so the recompute's EXISTS below can no longer see
  // it — the flipped workspaces must be carried across explicitly
  // (the sweep spec's dunning case caught exactly this ordering).
  const flipped = await db.execute(sql`
    UPDATE subscriptions
    SET status = 'canceled',
        cancel_source = COALESCE(cancel_source, 'provider'),
        updated_at = now()
    WHERE status = 'past_due'
      AND entitlement_ends_at IS NOT NULL
      AND entitlement_ends_at < now()
    RETURNING workspace_id
  `);
  const flippedWorkspaceIds = resultRows(flipped)
    .map((r) => r.workspace_id)
    .filter((v): v is string => typeof v === 'string');

  const recomputed = await db.execute(sql`
    UPDATE workspaces w
    SET tier = COALESCE(
          (SELECT s.tier FROM subscriptions s
           WHERE s.workspace_id = w.id
             AND s.status IN ('active', 'past_due')
             AND (s.entitlement_ends_at IS NULL OR s.entitlement_ends_at > now())
           ORDER BY CASE s.tier
             WHEN 'enterprise' THEN 5 WHEN 'team' THEN 4
             WHEN 'pro' THEN 3 WHEN 'plus' THEN 2 ELSE 1 END DESC
           LIMIT 1),
          'free'),
        founding_member = COALESCE(
          (SELECT bool_or(s.founding_member) FROM subscriptions s
           WHERE s.workspace_id = w.id
             AND s.status IN ('active', 'past_due')
             AND (s.entitlement_ends_at IS NULL OR s.entitlement_ends_at > now())),
          false),
        updated_at = now()
    WHERE EXISTS (
      SELECT 1 FROM subscriptions s
      WHERE s.workspace_id = w.id
        AND s.status IN ('active', 'past_due')
        AND s.entitlement_ends_at IS NOT NULL
        AND s.entitlement_ends_at < now()
    )
    OR ${flippedFilter(flippedWorkspaceIds)}
  `);

  // D249 (Codex 2026-07-30): retain expired claims for 7 days instead
  // of deleting at expiry. Checkout-reopening never depended on this
  // deletion (the claim upsert reclaims any row past expires_at, and
  // the FE ignores expired rows) — but the row's `provider_ref` is the
  // ONLY exact link to a Razorpay artifact, and a browser's stale lock
  // (which never auto-expires) reconciles through it. Deleting at
  // expiry left stale Razorpay locks releasable without ever asking
  // Razorpay about the still-payable subscription.
  const cleared = await db.execute(sql`
    DELETE FROM pending_checkouts WHERE expires_at < now() - interval '7 days'
  `);

  const stale = await db.execute(sql`
    SELECT workspace_id, scheduled_change_state, scheduled_change_requested_at
    FROM subscriptions
    WHERE scheduled_change_state IS NOT NULL
      AND scheduled_change_requested_at < now() - interval '7 days'
  `);
  const staleRows = resultRows(stale);
  for (const row of staleRows) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        kind: 'billing.reconcile.stale_scheduled_change',
        workspaceId: row.workspace_id,
        state: row.scheduled_change_state,
        requestedAt: row.scheduled_change_requested_at,
      }),
    );
  }

  // Step 5 — D251 unattended demote (doc block above). Tier list comes
  // from the manifest so a ladder move rewrites this predicate; the SQL
  // bodies mirror AutopilotReadService.demoteUnattendedRules (rule-flip
  // field semantics) and its claim-exclusion key construction mirrors
  // the action worker's `claimKey` — change one, change both.
  const demoted = await db.execute(sql`
    UPDATE automation_rules ar
    SET mode = 'observe',
        mode_changed_at = now(),
        observe_prompt_dismissed_at = NULL,
        updated_at = now()
    FROM mailbox_accounts ma
    JOIN workspaces w ON w.id = ma.workspace_id
    WHERE ar.mailbox_account_id = ma.id
      AND ar.mode = 'active'
      AND ${unentitledTierFilter()}
  `);
  const neutralized = await db.execute(sql`
    UPDATE rule_match_log rml
    SET resolution = 'dismissed',
        resolved_at = now(),
        dismiss_reason = 'entitlement'
    FROM mailbox_accounts ma
    JOIN workspaces w ON w.id = ma.workspace_id
    WHERE rml.mailbox_account_id = ma.id
      AND rml.mode_at_match = 'active'
      AND rml.resolution = 'approved'
      AND rml.intent_applied = false
      AND ${unentitledTierFilter()}
      AND NOT EXISTS (
        SELECT 1 FROM action_jobs aj
        WHERE aj.idempotency_key IN (
          'autopilot-' || rml.id::text,
          'autopilot-unsubexec-' || rml.id::text
        )
      )
  `);

  return {
    dunningFlipped: flippedWorkspaceIds.length,
    workspacesRecomputed: affectedCount(recomputed),
    pendingCheckoutsCleared: affectedCount(cleared),
    staleScheduledChanges: staleRows.length,
    unattendedRulesDemoted: affectedCount(demoted),
    unattendedMatchesNeutralized: affectedCount(neutralized),
  };
}

/**
 * `w.tier IN (<tiers that do NOT grant autopilot-active>)`, derived
 * from the manifest at call time. Per-value params (the same postgres.js
 * row-tuple trap `flippedFilter` documents below). The manifest always
 * has at least one such tier ('free' — an entitlements invariant test
 * pins Free below the automation set), so the IN list is never empty.
 */
function unentitledTierFilter() {
  const tiers = TIER_IDS.filter((t) => !hasCapability(t, 'autopilot-active'));
  return sql`w.tier IN (${sql.join(
    tiers.map((t) => sql`${t}::workspace_tier`),
    sql`, `,
  )})`;
}

/**
 * `db.execute` result shape differs by driver: postgres.js (prod)
 * returns an array-like with `.count`; PGlite (tests) returns
 * `{ rows, affectedRows }`. Normalize both — the sweep must mean the
 * same thing under the driver that tests it and the one that runs it.
 */
/**
 * `w.id IN (...)` from per-value params — NEVER a JS array param: the
 * postgres.js driver serializes a JS array as a ROW TUPLE, not a PG
 * array (the known drizzle raw-sql trap), and PGlite passing does not
 * prove prod. Empty list → FALSE so the OR contributes nothing.
 */
function flippedFilter(ids: string[]) {
  if (ids.length === 0) return sql`false`;
  return sql`w.id IN (${sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  )})`;
}

function affectedCount(r: unknown): number {
  const o = r as { count?: number; affectedRows?: number };
  return o?.count ?? o?.affectedRows ?? 0;
}

function resultRows(r: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(r)) return r as Array<Record<string, unknown>>;
  const rows = (r as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
}
