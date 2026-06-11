import { and, eq, gt, gte, inArray, sql, type SQL } from 'drizzle-orm';
import type { JobsOptions } from 'bullmq';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import {
  actionJobs,
  activityLog,
  AUTOPILOT_PRESET_KEYS,
  type AutopilotPresetKey,
  automationRules,
  mailboxAccounts,
  mailMessages,
  ruleMatchLog,
  type schema,
  senderPolicies,
  senders,
  undoJournal,
  workspaces,
} from '@declutrmail/db';
import {
  ActionsUnsubscribeIntentRecordedPayloadSchema,
  AutopilotActionIntentEmittedPayloadSchema,
  TOPICS,
} from '@declutrmail/events';

import { AUTOPILOT_PRESETS } from './autopilot-presets.js';
import { BaseDeclutrWorker } from './base-declutr-worker.js';
import type {
  GmailMutationAccess,
  GmailMutationClient,
  LabelChange,
} from './gmail-mutation-client.js';
import { labelChangeForVerb, type MailboxActionLock } from './label-action.worker.js';
import type { OutboxPublisher } from './outbox-publisher.js';
import type { UnsubExecutionJobData } from './unsub-execution.worker.js';
import { ValidationError } from './worker-errors.js';
import { WORKER_POLICIES } from './worker-policies.js';
import type { WorkerContext } from './worker-context.js';

type WorkerDb = PostgresJsDatabase<typeof schema>;

/**
 * AutopilotActionWorker (U14 — D99, D104, D226) — the action consumer
 * for Autopilot matches. Sweeps every `rule_match_log` row in a mailbox
 * with `resolution='approved' AND intent_applied=false` (Active-mode
 * rows auto-approve at insert; Observe-mode rows approve via
 * `POST /autopilot/matches/approve`) and executes each through the
 * verb's real pipeline:
 *
 *   - `archive` / `later` — the label-modify terminal-tx pattern
 *     (modelled on `LabelActionWorker.executeForward`, see "Seam
 *     choice" below): durable `action_jobs` row + resolved-id
 *     persistence BEFORE the Gmail mutation, `batchModify`, then one
 *     transaction issuing `undo_journal` + `activity_log`
 *     (`source='autopilot'`, `rule_id` set) + local label mirror +
 *     `autopilot.action_intent_emitted` outbox event + `action_jobs`
 *     done + match flip (`intent_applied=true`,
 *     `intent_token=<undo token>`).
 *
 *   - `unsubscribe` — `ActionsService.recordUnsubscribeIntent` path
 *     SEMANTICS (D38 / D9 Wave 2 / D230): activity_log decision row +
 *     `actions.unsubscribe_intent_recorded` outbox event (the
 *     senders-owned consumer projects `sender_policies`) + — for
 *     `one_click` senders only — a queued execution `action_jobs` row
 *     handed to `UnsubExecutionWorker`. Mailto stays MANUAL per D230
 *     (hard guardrail §2.6): autopilot never auto-sends a mailto
 *     opt-out; the intent is recorded, nothing is sent. No undo token
 *     is ever issued for unsubscribe (D58).
 *
 * SEAM CHOICE (documented per the U14 spec). Enqueueing `label-action`
 * jobs would reuse `LabelActionWorker` end-to-end, but that worker
 * hardcodes `activity_log.source='manual'` and has no attribution
 * channel for `rule_id` — and it is owned by U12 this wave, so adding
 * one is out of bounds. Mis-attributed audit rows would violate the
 * D104 audit contract ("source='autopilot' + rule_id"), so this worker
 * implements the SAME terminal-tx invariants directly (durable
 * execution set, idempotent mutation, per-mailbox advisory lock, undo
 * as a reverse job) with correct attribution. `labelChangeForVerb` (the
 * registry seam + fail-closed guards) IS shared; the small non-exported
 * helpers (`resolveLabelChange`, the mirror expression, the undo
 * payload) are replicated below with provenance comments — a follow-up
 * unifies them once U12's wave lands and the exports can move.
 *
 * Undo compatibility: the `action_jobs` forward row this worker writes
 * carries the issued `undo_token`, so the EXISTING revert machinery
 * (`ActionsService.enqueueCompositeRevert` → reverse `label-action`
 * job) reverses an autopilot action exactly like a manual one.
 *
 * GUARDS (in evaluation order, all per sweep):
 *   1. QUIET STATE (D92/D95 seam for U18): when
 *      `mailbox_accounts.quiet_state` says quiet is active, the whole
 *      sweep defers — no mutation, matches stay eligible, the next
 *      trigger re-runs. `isQuietStateActive` is the predicate U18's
 *      enforcement builds on.
 *   2. RULE STATE: matches whose rule is now disabled or paused are
 *      skipped (left pending) — D105's pause must stop execution even
 *      for already-approved matches.
 *   3. PROTECT RE-CHECK: `sender_policies.is_protected` / `is_vip` is
 *      re-read at EXECUTION time (the apply worker filtered at match
 *      time, but the user may have protected the sender since). A
 *      protected/VIP sender's match resolves to `dismissed` — a rule
 *      must NEVER act on a protected sender (D43, defense-in-depth).
 *   4. ALREADY-UNSUBSCRIBED: an unsub match whose sender already has
 *      the `sender_policies.policy_type='unsubscribe'` projection
 *      terminates as a no-op (intent is one-way per D58; active-mode
 *      re-matching must not duplicate intents or one-click POSTs).
 *   5. PER-RULE DAILY CAP: `dailyActionCap` from the preset definition,
 *      counted against `activity_log` rows (`source='autopilot'`,
 *      `rule_id`) in a rolling 24h window — verb-aware, see
 *      `countRuleActionsInWindow`. Over-cap matches stay
 *      `intent_applied=false` and execute on a later sweep.
 *
 * Policy: `perMailboxPolicy` (D203/D225). The whole sweep additionally
 * runs inside the per-mailbox advisory lock shared with
 * `LabelActionWorker`, so an autopilot archive can never interleave
 * with a user-initiated action on the same mailbox.
 *
 * Privacy (D7, D228): reads are metadata only (ids, sender_key, label
 * ids). The outbox payloads are Zod-gated; no body / snippet / subject.
 *
 * D222: no category prediction anywhere in this path.
 */

/** Queue + job name for the Autopilot action consumer. */
export const AUTOPILOT_ACTION_QUEUE = 'autopilot-action';
export const AUTOPILOT_ACTION_JOB = 'autopilot-action';

/** Rolling window for the per-rule daily action cap. */
const DAILY_CAP_WINDOW_MS = 24 * 60 * 60 * 1000;

/** D81 — Pro+ undo window (mirrors LabelActionWorker). */
const PRO_UNDO_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * One Autopilot action sweep over a mailbox. `triggeredAtMs` forms the
 * BullMQ `jobId` so duplicate adds within the same trigger window are
 * deduped; per-match idempotency is the `action_jobs` row keyed
 * `autopilot-<matchId>` plus the `intent_applied` flag.
 */
export interface AutopilotActionJobData {
  mailboxAccountId: string;
  triggeredAtMs: number;
}

/** Metrics from one sweep — logged on `worker.succeeded`. */
export interface AutopilotActionResult {
  /** Approved, un-applied matches the sweep loaded. */
  matchesConsidered: number;
  /** Label actions executed (incl. 0-affected decisions). */
  labelActionsExecuted: number;
  /** Unsubscribe intents recorded (one_click + mailto + none). */
  unsubscribeIntentsRecorded: number;
  /** Subset of intents that enqueued an RFC 8058 execution job. */
  unsubscribeExecutionsEnqueued: number;
  /** Matches dismissed because the sender is now Protected/VIP. */
  skippedProtected: number;
  /** Unsub matches no-opped because the sender is already unsubscribed. */
  skippedAlreadyUnsubscribed: number;
  /** Matches left pending because the rule's daily cap was reached. */
  skippedCapped: number;
  /** Matches left pending because the rule is now disabled/paused. */
  skippedRuleInactive: number;
  /** Matches left pending because the sender row is missing (race). */
  skippedMissingSender: number;
  /** True when the whole sweep deferred for an active quiet window. */
  deferredQuiet: boolean;
  durationMs: number;
}

export interface AutopilotActionDeps {
  db: WorkerDb;
  gmailMutation: GmailMutationAccess;
  outbox: OutboxPublisher;
  /** Per-mailbox advisory lock — share the LabelActionWorker instance. */
  lock: MailboxActionLock;
  /**
   * Enqueue an RFC 8058 one-click unsub execution job on the
   * `unsub-execution` queue. REQUIRED — recording a `pending`
   * unsub_status with no job behind it is the stuck state CLAUDE.md
   * §10 bans, so the dependency cannot be optional. The composition
   * root wires `(data) => queue.add(UNSUB_EXECUTION_JOB, data,
   * unsubExecutionJobOptions(data.idempotencyKey))`.
   */
  enqueueUnsubExecution: (data: UnsubExecutionJobData) => Promise<void>;
  /** Override clock for tests. Defaults to `() => new Date()`. */
  now?: () => Date;
}

/** BullMQ options — `jobId` dedups; attempts/backoff from the policy. */
export function autopilotActionJobOptions(jobId: string): JobsOptions {
  const policy = WORKER_POLICIES.perMailboxPolicy;
  return {
    jobId,
    attempts: policy.maxAttempts,
    ...(policy.backoff
      ? { backoff: { type: policy.backoff.type, delay: policy.backoff.delayMs } }
      : {}),
    removeOnComplete: { age: 86_400 },
    removeOnFail: false,
  };
}

/**
 * Quiet-state predicate (D92/D93 — the U18 enforcement seam).
 *
 * `mailbox_accounts.quiet_state` jsonb shape per D92:
 * `{ enabled, started_at, until_at, source }`. Quiet is ACTIVE when
 * `enabled === true` and `until_at` is absent, null, or in the future.
 * A present-but-unparseable `until_at` counts as ACTIVE — when the
 * stored state is ambiguous the safe side is to defer mutations, not
 * fire them.
 *
 * Exported so U18's quiet-enforcement (config UI + GET/PUT) reuses the
 * exact predicate this worker defers on — one definition of "quiet now".
 */
export function isQuietStateActive(quietState: unknown, now: Date): boolean {
  if (typeof quietState !== 'object' || quietState === null || Array.isArray(quietState)) {
    return false;
  }
  const state = quietState as Record<string, unknown>;
  if (state.enabled !== true) return false;
  const untilAt = state.until_at;
  if (untilAt === undefined || untilAt === null) return true;
  if (typeof untilAt !== 'string') return true;
  const parsed = Date.parse(untilAt);
  if (!Number.isFinite(parsed)) return true;
  return parsed > now.getTime();
}

/**
 * Gmail SYSTEM label ids — skip name→id resolution. Replicated from
 * `label-action.worker.ts` (not exported there; U12-owned this wave).
 */
const SYSTEM_LABEL_IDS: ReadonlySet<string> = new Set([
  'INBOX',
  'TRASH',
  'UNREAD',
  'SPAM',
  'STARRED',
  'IMPORTANT',
  'SENT',
  'DRAFT',
]);

/**
 * Resolve every non-system label NAME in a `LabelChange` to its Gmail
 * label id. Replicated from `label-action.worker.ts` (same invariant:
 * Gmail mutates by ID, the registry speaks NAMES — live smoke
 * 2026-06-09 proved the unresolved name 400s).
 */
async function resolveLabelChange(
  client: GmailMutationClient,
  change: LabelChange,
): Promise<LabelChange> {
  const resolveAll = (labels: string[]): Promise<string[]> =>
    Promise.all(
      labels.map((label) =>
        SYSTEM_LABEL_IDS.has(label) ? Promise.resolve(label) : client.ensureLabelId(label),
      ),
    );
  return {
    ...(change.addLabelIds ? { addLabelIds: await resolveAll(change.addLabelIds) } : {}),
    ...(change.removeLabelIds ? { removeLabelIds: await resolveAll(change.removeLabelIds) } : {}),
  };
}

/**
 * Local-mirror `labelIds` UPDATE expression. Replicated from
 * `label-action.worker.ts` (`buildLabelMirrorExpr`) — idempotent
 * remove/append, every label bound as a scalar parameter.
 */
function buildLabelMirrorExpr(change: { addLabelIds?: string[]; removeLabelIds?: string[] }): SQL {
  let expr: SQL = sql`${mailMessages.labelIds}`;
  for (const label of change.removeLabelIds ?? []) {
    expr = sql`array_remove(${expr}, ${label})`;
  }
  for (const label of change.addLabelIds ?? []) {
    expr = sql`(CASE WHEN ${label} = ANY(${expr}) THEN ${expr} ELSE array_append(${expr}, ${label}) END)`;
  }
  return expr;
}

/** One eligible match row joined with its rule + sender identity. */
interface EligibleMatch {
  matchId: string;
  ruleId: string;
  senderKey: string;
  presetKey: string | null;
  actionKind: 'archive' | 'unsubscribe' | 'later' | string;
  ruleEnabled: boolean;
  ruleMode: string;
  senderId: string | null;
  unsubscribeMethod: 'one_click' | 'mailto' | 'none' | null;
}

export class AutopilotActionWorker extends BaseDeclutrWorker<
  AutopilotActionJobData,
  AutopilotActionResult
> {
  override readonly workerName = 'AutopilotActionWorker';
  override readonly policy = 'perMailboxPolicy' as const;

  constructor(private readonly deps: AutopilotActionDeps) {
    super();
  }

  protected override getIdempotencyKey(payload: AutopilotActionJobData): string {
    return `${payload.mailboxAccountId}:${payload.triggeredAtMs}`;
  }

  override async processJob(
    payload: AutopilotActionJobData,
    _ctx: WorkerContext,
  ): Promise<AutopilotActionResult> {
    if (!payload?.mailboxAccountId) {
      throw new ValidationError('AutopilotActionJobData.mailboxAccountId is required');
    }
    return this.deps.lock.run(payload.mailboxAccountId, () => this.sweep(payload));
  }

  private async sweep(payload: AutopilotActionJobData): Promise<AutopilotActionResult> {
    const startedAt = Date.now();
    const { mailboxAccountId } = payload;
    const now = (this.deps.now ?? (() => new Date()))();

    const result: AutopilotActionResult = {
      matchesConsidered: 0,
      labelActionsExecuted: 0,
      unsubscribeIntentsRecorded: 0,
      unsubscribeExecutionsEnqueued: 0,
      skippedProtected: 0,
      skippedAlreadyUnsubscribed: 0,
      skippedCapped: 0,
      skippedRuleInactive: 0,
      skippedMissingSender: 0,
      deferredQuiet: false,
      durationMs: 0,
    };

    // Guard 1 — quiet state (U18 seam). Defer the WHOLE sweep; matches
    // stay `intent_applied=false` so the next trigger re-runs them.
    const [mailbox] = await this.deps.db
      .select({ quietState: mailboxAccounts.quietState })
      .from(mailboxAccounts)
      .where(eq(mailboxAccounts.id, mailboxAccountId))
      .limit(1);
    if (!mailbox) {
      throw new ValidationError(`mailbox account ${mailboxAccountId} not found`);
    }
    if (isQuietStateActive(mailbox.quietState, now)) {
      console.log(
        JSON.stringify({
          level: 'info',
          kind: 'autopilot.action.quiet_deferred',
          worker: this.workerName,
          mailboxAccountId,
        }),
      );
      result.deferredQuiet = true;
      result.durationMs = Date.now() - startedAt;
      return result;
    }

    const matches = await this.loadEligibleMatches(mailboxAccountId);
    result.matchesConsidered = matches.length;
    if (matches.length === 0) {
      result.durationMs = Date.now() - startedAt;
      return result;
    }

    // Guard 3 — protect re-check at execution time, one query for the
    // whole sweep's senders. The same rows feed the already-unsubscribed
    // guard (policy_type='unsubscribe' is the senders-owned projection
    // of a recorded intent).
    const senderKeys = [...new Set(matches.map((m) => m.senderKey))];
    const policyRows = await this.deps.db
      .select({
        senderKey: senderPolicies.senderKey,
        policyType: senderPolicies.policyType,
        isProtected: senderPolicies.isProtected,
        isVip: senderPolicies.isVip,
      })
      .from(senderPolicies)
      .where(
        and(
          eq(senderPolicies.mailboxAccountId, mailboxAccountId),
          inArray(senderPolicies.senderKey, senderKeys),
        ),
      );
    const shieldedBy = new Map(policyRows.map((r) => [r.senderKey, r.isProtected || r.isVip]));
    const alreadyUnsubscribed = new Set(
      policyRows.filter((r) => r.policyType === 'unsubscribe').map((r) => r.senderKey),
    );

    // Guard 4 — per-rule remaining daily budget (rolling 24h).
    const remainingByRule = new Map<string, number>();

    for (const match of matches) {
      // Guard 2 — rule must still be enabled + not paused (D105).
      if (!match.ruleEnabled || match.ruleMode === 'paused') {
        result.skippedRuleInactive += 1;
        continue;
      }
      // Custom rules never execute at V2 (D197/D234) — and an unknown
      // preset key has no cap definition, so fail closed.
      if (!isPresetKey(match.presetKey)) {
        result.skippedRuleInactive += 1;
        continue;
      }

      if (shieldedBy.get(match.senderKey)) {
        await this.dismissShieldedMatch(match, now);
        result.skippedProtected += 1;
        continue;
      }

      if (!match.senderId) {
        // senders row not materialised yet (building_sender_index
        // race). Leave the match pending; a later sweep retries.
        result.skippedMissingSender += 1;
        continue;
      }

      // Already-unsubscribed guard: active-mode rules re-match a sender
      // on EVERY sweep (no active-mode dedup by design — new mail must
      // re-trigger), but an unsubscribe intent is one-way (D58). When
      // the sender already carries the `policy_type='unsubscribe'`
      // projection, the match terminates as a no-op — no duplicate
      // intent row, no duplicate one-click POST.
      if (match.actionKind === 'unsubscribe' && alreadyUnsubscribed.has(match.senderKey)) {
        await this.flipMatchApplied(match.matchId, null, now);
        result.skippedAlreadyUnsubscribed += 1;
        continue;
      }

      let remaining = remainingByRule.get(match.ruleId);
      if (remaining === undefined) {
        const cap = AUTOPILOT_PRESETS[match.presetKey].dailyActionCap;
        const executed24h = await this.countRuleActionsInWindow(
          match.ruleId,
          match.actionKind,
          now,
        );
        remaining = Math.max(0, cap - executed24h);
        remainingByRule.set(match.ruleId, remaining);
      }
      if (remaining <= 0) {
        result.skippedCapped += 1;
        continue;
      }

      try {
        if (match.actionKind === 'archive' || match.actionKind === 'later') {
          await this.executeLabelAction(mailboxAccountId, match, now);
          result.labelActionsExecuted += 1;
        } else if (match.actionKind === 'unsubscribe') {
          const { executionEnqueued } = await this.executeUnsubscribeIntent(
            mailboxAccountId,
            match,
            now,
          );
          result.unsubscribeIntentsRecorded += 1;
          if (executionEnqueued) result.unsubscribeExecutionsEnqueued += 1;
        } else {
          // 'keep' (or a future verb) — Autopilot never fires on Keep;
          // a row like this is data drift. Fail closed: skip + log.
          console.warn(
            JSON.stringify({
              level: 'warn',
              kind: 'autopilot.action.unknown_action_kind',
              worker: this.workerName,
              matchId: match.matchId,
              actionKind: match.actionKind,
            }),
          );
          continue;
        }
        remainingByRule.set(match.ruleId, remaining - 1);
      } catch (err) {
        // One match's failure (Gmail quota, transient DB error) must
        // not kill the sweep — the match stays `intent_applied=false`
        // and retries on the next trigger; the count surfaces here.
        console.error(
          JSON.stringify({
            level: 'error',
            kind: 'autopilot.action.match_failed',
            worker: this.workerName,
            matchId: match.matchId,
            ruleId: match.ruleId,
            mailboxAccountId,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }

    result.durationMs = Date.now() - startedAt;
    return result;
  }

  /**
   * Approved, un-applied matches joined with rule + sender identity.
   * Oldest first so a capped rule executes its earliest suggestions
   * before newer ones.
   */
  private async loadEligibleMatches(mailboxAccountId: string): Promise<EligibleMatch[]> {
    const rows = await this.deps.db
      .select({
        matchId: ruleMatchLog.id,
        ruleId: ruleMatchLog.ruleId,
        senderKey: ruleMatchLog.senderKey,
        presetKey: automationRules.presetKey,
        actionKind: automationRules.actionKind,
        ruleEnabled: automationRules.enabled,
        ruleMode: automationRules.mode,
        senderId: senders.id,
        unsubscribeMethod: senders.unsubscribeMethod,
      })
      .from(ruleMatchLog)
      .innerJoin(automationRules, eq(automationRules.id, ruleMatchLog.ruleId))
      .leftJoin(
        senders,
        and(
          eq(senders.mailboxAccountId, ruleMatchLog.mailboxAccountId),
          eq(senders.senderKey, ruleMatchLog.senderKey),
        ),
      )
      .where(
        and(
          eq(ruleMatchLog.mailboxAccountId, mailboxAccountId),
          eq(ruleMatchLog.resolution, 'approved'),
          eq(ruleMatchLog.intentApplied, false),
        ),
      )
      .orderBy(ruleMatchLog.matchedAt, ruleMatchLog.id);
    return rows;
  }

  /**
   * Rolling-24h executed-action count for one rule (cap basis). The
   * cap bounds REAL work, so the count is verb-aware:
   *
   *   - label verbs (archive/later): only rows that MOVED messages
   *     (`affected_count > 0`) count. 0-affected decisions (the rule
   *     fired but the sender had nothing in INBOX — the common case on
   *     re-sweeps, since active-mode matching re-runs per trigger by
   *     design) mutate nothing and must not starve the budget.
   *   - unsubscribe: every intent row counts — intent rows are always
   *     `affected_count=0` (no messages move) but each IS the action.
   */
  private async countRuleActionsInWindow(
    ruleId: string,
    actionKind: string,
    now: Date,
  ): Promise<number> {
    const windowStart = new Date(now.getTime() - DAILY_CAP_WINDOW_MS);
    const [row] = await this.deps.db
      .select({ n: sql<number>`count(*)::int` })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.ruleId, ruleId),
          eq(activityLog.source, 'autopilot'),
          gte(activityLog.occurredAt, windowStart),
          ...(actionKind === 'unsubscribe' ? [] : [gt(activityLog.affectedCount, 0)]),
        ),
      );
    return row?.n ?? 0;
  }

  /**
   * A sender that became Protected/VIP after the match was logged:
   * never act (D43). The match resolves to `dismissed` — terminal,
   * auditable, and out of the pending sweep.
   */
  private async dismissShieldedMatch(match: EligibleMatch, now: Date): Promise<void> {
    await this.deps.db
      .update(ruleMatchLog)
      .set({ resolution: 'dismissed', resolvedAt: now })
      .where(and(eq(ruleMatchLog.id, match.matchId), eq(ruleMatchLog.intentApplied, false)));
    console.log(
      JSON.stringify({
        level: 'info',
        kind: 'autopilot.action.skipped_protected',
        worker: this.workerName,
        matchId: match.matchId,
        ruleId: match.ruleId,
      }),
    );
  }

  /**
   * Archive / Later execution — the label-modify terminal-tx pattern
   * with `source='autopilot'` attribution. Invariants mirrored from
   * `LabelActionWorker.executeForward`:
   *   - durable execution set persisted BEFORE the Gmail mutation
   *   - idempotent batchModify (re-removing INBOX is a no-op)
   *   - one terminal tx for undo + activity + mirror + event + flips
   */
  private async executeLabelAction(
    mailboxAccountId: string,
    match: EligibleMatch,
    now: Date,
  ): Promise<void> {
    const { db } = this.deps;
    const verb = match.actionKind as 'archive' | 'later';
    const idempotencyKey = `autopilot-${match.matchId}`;

    // Durable action row — find or create. The key is the match id, so
    // a sweep retry resumes the SAME action (and its persisted ids).
    let [job] = await db
      .select()
      .from(actionJobs)
      .where(eq(actionJobs.idempotencyKey, idempotencyKey))
      .limit(1);
    if (job && job.status === 'done') {
      // Terminal tx already committed (it flips the match in the same
      // tx, so reaching here means a defensive replay). Re-flip the
      // match idempotently and move on.
      await this.flipMatchApplied(match.matchId, job.undoToken, now);
      return;
    }
    if (!job) {
      const senderId = match.senderId;
      if (!senderId) {
        throw new ValidationError(`match ${match.matchId} has no resolved sender id`);
      }
      await db
        .insert(actionJobs)
        .values({
          mailboxAccountId,
          verb,
          direction: 'forward',
          selector: { type: 'sender', senderId, senderKey: match.senderKey },
          resolvedMessageIds: [],
          requestedCount: 0,
          status: 'queued',
          idempotencyKey,
        })
        .onConflictDoNothing({ target: actionJobs.idempotencyKey });
      [job] = await db
        .select()
        .from(actionJobs)
        .where(eq(actionJobs.idempotencyKey, idempotencyKey))
        .limit(1);
      if (!job) {
        throw new ValidationError(`action_jobs row for ${idempotencyKey} not found after insert`);
      }
    }

    // Resolve the durable execution set BEFORE the mutation. A prior
    // attempt's persisted set is reused verbatim — never re-resolved.
    let ids = job.resolvedMessageIds;
    if (ids.length === 0) {
      ids = await this.resolveSenderInboxIds(mailboxAccountId, match.senderKey);
      await db
        .update(actionJobs)
        .set({
          resolvedMessageIds: ids,
          requestedCount: ids.length,
          status: 'executing',
          errorCode: null,
          updatedAt: sql`now()`,
        })
        .where(eq(actionJobs.id, job.id));
    } else {
      await db
        .update(actionJobs)
        .set({ status: 'executing', errorCode: null, updatedAt: sql`now()` })
        .where(eq(actionJobs.id, job.id));
    }

    // Zero matching messages — the rule DECIDED but nothing moved.
    // Audit reflects the decision (same precedent as the manual path's
    // 0-affected rows); no undo token (nothing to reverse).
    if (ids.length === 0) {
      await db.transaction(async (tx) => {
        await tx
          .update(actionJobs)
          .set({ status: 'done', affectedCount: 0, updatedAt: sql`now()` })
          .where(eq(actionJobs.id, job.id));
        await tx.insert(activityLog).values({
          mailboxAccountId,
          senderKey: match.senderKey,
          source: 'autopilot',
          action: verb,
          affectedCount: 0,
          undoToken: null,
          ruleId: match.ruleId,
        });
        await tx
          .update(ruleMatchLog)
          .set({ intentApplied: true, resolvedAt: now })
          .where(and(eq(ruleMatchLog.id, match.matchId), eq(ruleMatchLog.intentApplied, false)));
      });
      return;
    }

    const client = await this.deps.gmailMutation.getClient(mailboxAccountId);
    const change = labelChangeForVerb(verb);
    const resolved = await resolveLabelChange(client, change.forward);
    await client.batchModify(ids, resolved);

    const expiresAt = await this.undoExpiresAt(mailboxAccountId);

    await db.transaction(async (tx) => {
      const [issued] = await tx
        .insert(undoJournal)
        .values({
          mailboxAccountId,
          actionKind: verb,
          payload: { kind: verb, messageIds: ids, priorLabels: ['INBOX'] as string[] },
          ...(expiresAt ? { expiresAt } : {}),
        })
        .returning({ token: undoJournal.token });
      if (!issued) {
        throw new Error('undo_journal insert returned no row');
      }

      await tx.insert(activityLog).values({
        mailboxAccountId,
        senderKey: match.senderKey,
        source: 'autopilot',
        action: verb,
        affectedCount: ids.length,
        undoToken: issued.token,
        ruleId: match.ruleId,
      });

      // Local label mirror — same derivation as LabelActionWorker so
      // the UI + the next resolve see the post-action label set.
      await tx
        .update(mailMessages)
        .set({
          labelIds: buildLabelMirrorExpr(resolved),
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(mailMessages.mailboxAccountId, mailboxAccountId),
            inArray(mailMessages.providerMessageId, ids),
          ),
        );

      await this.deps.outbox.publish(tx, {
        topic: TOPICS.AUTOPILOT_ACTION_INTENT_EMITTED,
        aggregateId: match.matchId,
        payload: {
          mailboxAccountId,
          ruleId: match.ruleId,
          matchId: match.matchId,
          senderKey: match.senderKey,
          actionKind: verb,
          undoToken: issued.token,
        },
        schema: AutopilotActionIntentEmittedPayloadSchema,
      });

      await tx
        .update(actionJobs)
        .set({
          status: 'done',
          affectedCount: ids.length,
          undoToken: issued.token,
          updatedAt: sql`now()`,
        })
        .where(eq(actionJobs.id, job.id));

      await tx
        .update(ruleMatchLog)
        .set({ intentApplied: true, intentToken: issued.token, resolvedAt: now })
        .where(and(eq(ruleMatchLog.id, match.matchId), eq(ruleMatchLog.intentApplied, false)));
    });
  }

  /**
   * Unsubscribe execution — `recordUnsubscribeIntent` path semantics
   * (D38, D9 Wave 2, D230): record the decision + emit the senders-
   * owned projection event; enqueue the RFC 8058 execution for
   * `one_click` senders only. Mailto/none record intent and stop —
   * autopilot NEVER auto-sends a mailto opt-out (D230, §2.6).
   */
  private async executeUnsubscribeIntent(
    mailboxAccountId: string,
    match: EligibleMatch,
    now: Date,
  ): Promise<{ executionEnqueued: boolean }> {
    const { db } = this.deps;
    const method: 'one_click' | 'mailto' | 'none' = match.unsubscribeMethod ?? 'none';
    const executionKey = `autopilot-unsubexec-${match.matchId}`;

    const executionActionId = await db.transaction(async (tx) => {
      const [audit] = await tx
        .insert(activityLog)
        .values({
          mailboxAccountId,
          senderKey: match.senderKey,
          source: 'autopilot',
          action: 'unsubscribe',
          affectedCount: 0,
          // D58 — no undo token is ever issued for an unsubscribe.
          undoToken: null,
          ruleId: match.ruleId,
        })
        .returning({ id: activityLog.id, occurredAt: activityLog.occurredAt });
      if (!audit) {
        throw new Error('activity_log insert returned no row');
      }

      // D204 boundary — sender_policies is senders-owned; this event is
      // the projection channel (the same consumer the manual path uses).
      await this.deps.outbox.publish(tx, {
        topic: TOPICS.ACTIONS_UNSUBSCRIBE_INTENT_RECORDED,
        aggregateId: audit.id,
        payload: {
          mailboxAccountId,
          senderKey: match.senderKey,
          activityLogId: audit.id,
          recordedAt: audit.occurredAt.toISOString(),
          method,
        },
        schema: ActionsUnsubscribeIntentRecordedPayloadSchema,
      });

      // Execution row — one_click only; `UnsubExecutionWorker` flips it
      // terminal. Same-tx as the audit row so they commit atomically.
      let actionId: string | null = null;
      if (method === 'one_click') {
        const senderId = match.senderId;
        if (!senderId) {
          throw new ValidationError(`match ${match.matchId} has no resolved sender id`);
        }
        const [existing] = await tx
          .insert(actionJobs)
          .values({
            mailboxAccountId,
            verb: 'unsubscribe',
            direction: 'forward',
            selector: { type: 'sender', senderId, senderKey: match.senderKey },
            resolvedMessageIds: [],
            requestedCount: 1,
            status: 'queued',
            idempotencyKey: executionKey,
          })
          .onConflictDoNothing({ target: actionJobs.idempotencyKey })
          .returning({ id: actionJobs.id });
        actionId = existing?.id ?? null;
        if (!actionId) {
          const [row] = await tx
            .select({ id: actionJobs.id })
            .from(actionJobs)
            .where(eq(actionJobs.idempotencyKey, executionKey))
            .limit(1);
          actionId = row?.id ?? null;
        }
      }

      await tx
        .update(ruleMatchLog)
        .set({ intentApplied: true, resolvedAt: now })
        .where(and(eq(ruleMatchLog.id, match.matchId), eq(ruleMatchLog.intentApplied, false)));

      return actionId;
    });

    // Post-commit enqueue (every producer path's ordering). On enqueue
    // failure the action row flips `failed` so the gap is observable —
    // mirrors `ActionsService.enqueueUnsubExecution`.
    if (executionActionId) {
      try {
        await this.deps.enqueueUnsubExecution({
          actionId: executionActionId,
          mailboxAccountId,
          idempotencyKey: executionKey,
        });
        return { executionEnqueued: true };
      } catch (err) {
        await db
          .update(actionJobs)
          .set({ status: 'failed', errorCode: 'ENQUEUE_FAILED', updatedAt: sql`now()` })
          .where(eq(actionJobs.id, executionActionId));
        console.error(
          JSON.stringify({
            level: 'error',
            kind: 'autopilot.action.unsub_enqueue_failed',
            worker: this.workerName,
            matchId: match.matchId,
            actionId: executionActionId,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }
    return { executionEnqueued: false };
  }

  /** Defensive re-flip for an already-done action row (idempotent). */
  private async flipMatchApplied(
    matchId: string,
    undoToken: string | null,
    now: Date,
  ): Promise<void> {
    await this.deps.db
      .update(ruleMatchLog)
      .set({ intentApplied: true, intentToken: undoToken, resolvedAt: now })
      .where(and(eq(ruleMatchLog.id, matchId), eq(ruleMatchLog.intentApplied, false)));
  }

  /**
   * Sender → `provider_message_id`s currently in INBOX. Same resolution
   * as `LabelActionWorker.resolveSenderInboxIds` (no time-window filter
   * — autopilot presets act on the full inbox set).
   */
  private async resolveSenderInboxIds(
    mailboxAccountId: string,
    senderKey: string,
  ): Promise<string[]> {
    const rows = await this.deps.db
      .select({ providerMessageId: mailMessages.providerMessageId })
      .from(mailMessages)
      .where(
        and(
          eq(mailMessages.mailboxAccountId, mailboxAccountId),
          eq(mailMessages.senderKey, senderKey),
          sql`'INBOX' = ANY(${mailMessages.labelIds})`,
        ),
      );
    return rows.map((r) => r.providerMessageId);
  }

  /**
   * D81 undo window — Pro+ → 30d; Free/Plus → the column default (7d)
   * via `undefined`. Mirrors `LabelActionWorker.undoExpiresAt` for the
   * archive/later verbs (autopilot never emits `delete`).
   */
  private async undoExpiresAt(mailboxAccountId: string): Promise<Date | undefined> {
    const [row] = await this.deps.db
      .select({ tier: workspaces.tier })
      .from(mailboxAccounts)
      .innerJoin(workspaces, eq(workspaces.id, mailboxAccounts.workspaceId))
      .where(eq(mailboxAccounts.id, mailboxAccountId))
      .limit(1);
    const tier = row?.tier;
    if (tier === 'pro' || tier === 'team' || tier === 'enterprise') {
      return new Date(Date.now() + PRO_UNDO_WINDOW_MS);
    }
    return undefined;
  }
}

const PRESET_KEY_SET = new Set<string>(AUTOPILOT_PRESET_KEYS);
function isPresetKey(k: string | null): k is AutopilotPresetKey {
  return k !== null && PRESET_KEY_SET.has(k);
}
