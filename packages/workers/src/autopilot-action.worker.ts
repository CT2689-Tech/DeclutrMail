import { and, eq, gt, gte, inArray, ne, sql, type SQL } from 'drizzle-orm';
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
  senderInboxActionWhere,
  senderPolicies,
  senders,
  undoJournal,
  workspaces,
} from '@declutrmail/db';
import {
  ActionLabelAppliedPayloadSchema,
  ActionsUnsubscribeExecutedPayloadSchema,
  ActionsUnsubscribeIntentRecordedPayloadSchema,
  AutopilotActionIntentEmittedPayloadSchema,
  TOPICS,
} from '@declutrmail/events';
import { defaultLaterWakeAtIso, unsubscribeCapabilityOf } from '@declutrmail/shared/actions';
import { hasCapability, undoWindowDaysFor } from '@declutrmail/shared/entitlements';

import { AUTOPILOT_PRESETS } from './autopilot-presets.js';
import { BaseDeclutrWorker } from './base-declutr-worker.js';
import type {
  GmailMutationAccess,
  GmailMutationClient,
  LabelChange,
} from './gmail-mutation-client.js';
import { labelChangeForVerb, type MailboxActionLock } from './label-action.worker.js';
import { lockSenderIndex } from './sender-index-lock.js';
import type { OutboxPublisher } from './outbox-publisher.js';
import { isQuietActive, msUntilQuietEnds } from './quiet-hours-state.js';
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
 *   1. ENTITLEMENT: the mailbox workspace must currently grant
 *      `autopilot` (the review capability, Plus+Pro). Matches with
 *      `modeAtMatch='active'` additionally require `autopilot-active`
 *      (D251) — a Pro→Plus downgrade stops unattended matches while
 *      human-approved batches still complete.
 *   2. QUIET (U18 — D92/D93/D95): when `mailbox_accounts.quiet_state`
 *      says quiet is active — the manual toggle OR the recurring
 *      quiet-hours window (`isQuietActive`, quiet-hours-state.ts) —
 *      the whole sweep defers: no mutation, matches stay eligible, and
 *      `onQuietDeferred` re-schedules a delayed sweep for when quiet
 *      ends (next trigger is the safety net). Manual user actions are
 *      NOT gated — quiet defers automation only.
 *   3. RULE STATE: matches whose rule is now disabled or paused are
 *      skipped (left pending) — D105's pause must stop execution even
 *      for already-approved matches.
 *   4. PROTECT RE-CHECK: `sender_policies.is_protected` is
 *      re-read at EXECUTION time (the apply worker filtered at match
 *      time, but the user may have protected the sender since). A
 *      protected sender's match resolves to `dismissed` — a rule
 *      must NEVER act on a protected sender (D43, defense-in-depth).
 *   5. ALREADY-UNSUBSCRIBED: an unsub match whose sender already has
 *      the `sender_policies.policy_type='unsubscribe'` projection
 *      terminates as a no-op (intent is one-way per D58; active-mode
 *      re-matching must not duplicate intents or one-click POSTs).
 *   6. PER-RULE DAILY CAP: `dailyActionCap` from the preset definition,
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

/**
 * Is a match's evidence still the CURRENT sender index — or already
 * claimed for execution?
 *
 * `InitialSyncWorker` rebuilds `senders` by DELETE + re-INSERT, so a
 * sender row created after the match means the rule decided on mail the
 * mailbox no longer holds; executing it would mutate Gmail on deleted
 * evidence. The second branch is the escape hatch: once the durable
 * `action_jobs` claim exists the action is legitimately in flight (the
 * rebuild's cleanup skips it for the same reason), and dropping it would
 * strand a Gmail change with no row to flip or audit against.
 *
 * ONE definition, used by both the sweep's load and the per-match
 * re-check. They were briefly written out twice and drifted on the very
 * first edit — the load filtered claimed matches the re-check would have
 * allowed.
 *
 * `sql.raw` for the outer columns: an interpolated Drizzle column emits
 * a BARE name that would bind to the subquery's own table and make this
 * a tautology (LEARNINGS — correlated-subquery pitfall).
 */
const MATCH_EVIDENCE_CURRENT: SQL = sql`(
  not exists (
    select 1
    from senders s
    where s.mailbox_account_id = ${sql.raw('rule_match_log.mailbox_account_id')}
      and s.sender_key = ${sql.raw('rule_match_log.sender_key')}
      and s.created_at > ${sql.raw('rule_match_log.matched_at')}
  )
  or exists (
    select 1
    from action_jobs aj
    where aj.idempotency_key = 'autopilot-' || ${sql.raw('rule_match_log.id')}::text
  )
)`;

/**
 * Does this claim mean Gmail may ALREADY have been mutated?
 *
 * The worker persists `resolvedMessageIds` and flips the row to
 * `executing` immediately BEFORE `batchModify`, precisely so a crashed
 * attempt can re-apply the same set. `done` is excluded: its terminal
 * transaction committed, so the action is already audited and undoable.
 *
 * A pure function so the batched sweep lookup and the single-claim
 * re-check cannot drift — duplicating a predicate has already cost this
 * file one bug (see MISTAKES.md 2026-07-25).
 */
function claimIsInFlight(
  claim: { status: string; resolvedMessageIds: string[] } | null | undefined,
): boolean {
  if (claim == null || claim.status === 'done') return false;
  return claim.status !== 'queued' || claim.resolvedMessageIds.length > 0;
}

/**
 * Idempotency-key prefixes of a match's durable execution claim
 * (`<prefix><matchId>`). Exported for the D251 demotion facade
 * (`AutopilotReadService.demoteUnattendedRules`), whose claim-exclusion
 * SQL must recognize every claim this worker can have written — both
 * sides building from ONE constant is what keeps a future key-format
 * change from silently dismissing matches whose claim already mutated
 * Gmail.
 */
export const AUTOPILOT_CLAIM_KEY_PREFIXES = ['autopilot-', 'autopilot-unsubexec-'] as const;

/** Idempotency key of a match's durable execution claim. */
function claimKey(match: { matchId: string; actionKind: string }): string {
  return match.actionKind === 'unsubscribe'
    ? `${AUTOPILOT_CLAIM_KEY_PREFIXES[1]}${match.matchId}`
    : `${AUTOPILOT_CLAIM_KEY_PREFIXES[0]}${match.matchId}`;
}

/** Bind-parameter chunk for the sweep's batched claim lookup. */
const CLAIM_LOOKUP_CHUNK = 500;

/** Rolling window for the per-rule daily action cap. */
const DAILY_CAP_WINDOW_MS = 24 * 60 * 60 * 1000;

/** One day in ms — the manifest states the window in DAYS. */
const DAY_MS = 24 * 60 * 60 * 1000;

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
  /** Matches dismissed because the sender is now Protected. */
  skippedProtected: number;
  /** Unsub matches no-opped because the sender is already unsubscribed. */
  skippedAlreadyUnsubscribed: number;
  /** Matches left pending because the rule's daily cap was reached. */
  skippedCapped: number;
  /** Matches left pending because the rule is now disabled/paused. */
  skippedRuleInactive: number;
  /** Matches left pending because the sender row is missing (race). */
  skippedMissingSender: number;
  /**
   * Claimed matches retired because the sender index was rebuilt and
   * their sender never came back — the claim would otherwise be retried
   * on every sweep forever.
   */
  abandonedStaleClaim: number;
  /**
   * Matches left pending because the sender index was rebuilt after
   * `loadEligibleMatches` filtered them — checked again immediately
   * before the Gmail call so a rebuild landing mid-sweep cannot get a
   * mutation executed on evidence it just deleted.
   */
  skippedIndexRebuilt: number;
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
   * `unsub-execution` queue. REQUIRED — recording a `requested`
   * unsub_status with no job behind it is the stuck state CLAUDE.md
   * §10 bans, so the dependency cannot be optional. The composition
   * root wires `(data) => queue.add(UNSUB_EXECUTION_JOB, data,
   * unsubExecutionJobOptions(data.idempotencyKey))`.
   */
  enqueueUnsubExecution: (data: UnsubExecutionJobData) => Promise<void>;
  /**
   * Optional hook fired when a sweep DEFERS for quiet (U18 — D92/D93).
   * `resumeAfterMs` is the minute-granular hint until quiet ends, or
   * `null` when no hint is computable (indefinite manual quiet). The
   * composition root wires this to enqueue a DELAYED `autopilot-action`
   * job so deferred matches sweep right after the window closes even
   * if no new trigger (sync-ready / score-completed / approve) fires.
   *
   * Best-effort: a failure here is logged and swallowed — the matches
   * are durable (`intent_applied=false`) and the next trigger's sweep
   * is the safety net, so deferral can NEVER drop an action.
   */
  onQuietDeferred?: (mailboxAccountId: string, resumeAfterMs: number | null) => Promise<void>;
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
 * Quiet predicates (D92/D93 — the U18 enforcement seam) live in
 * `quiet-hours-state.ts` next to the persistence helpers, so the
 * worker, the GET/PUT API, and the config UI all defer/report on ONE
 * definition of "quiet now". `isQuietStateActive` (the manual-toggle
 * predicate this worker originally defined) is re-exported for
 * existing importers.
 */
export { isQuietStateActive } from './quiet-hours-state.js';

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
  /**
   * D251 — the rule's mode WHEN THIS MATCH WAS RECORDED, which is the
   * provenance the entitlement gate keys on. `observe` means a human
   * approved this batch (Plus is entitled to that); `active` means the
   * rule acted unattended (Pro only). `ruleMode` is the rule's mode NOW
   * and can have changed since, so it must NOT be used for the gate.
   */
  modeAtMatch: string;
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
      skippedIndexRebuilt: 0,
      abandonedStaleClaim: 0,
      deferredQuiet: false,
      durationMs: 0,
    };

    // Guards 1–2 — current entitlement, then quiet (U18, D92/D93):
    // manual toggle OR recurring
    // quiet-hours window. Defer the WHOLE sweep; matches stay
    // `intent_applied=false` so a later sweep re-runs them (the
    // deferral re-schedules via `onQuietDeferred` when the quiet end
    // is computable — actions are deferred, never dropped).
    const [mailbox] = await this.deps.db
      .select({ quietState: mailboxAccounts.quietState, tier: workspaces.tier })
      .from(mailboxAccounts)
      .innerJoin(workspaces, eq(workspaces.id, mailboxAccounts.workspaceId))
      .where(eq(mailboxAccounts.id, mailboxAccountId))
      .limit(1);
    if (!mailbox) {
      throw new ValidationError(`mailbox account ${mailboxAccountId} not found`);
    }
    // A sweep-level gate stops NEW work — it must not strand work that
    // already moved mail. Both gates below used to `return` before the
    // matches were even loaded, so an in-flight claim (Gmail mutated,
    // terminal transaction not yet committed) was left with no Activity
    // row and no undo token. Quiet at least re-schedules; a downgrade
    // never runs again, so the change was invisible and unrecoverable
    // forever. Record the reason instead and fall through to a
    // completion-only pass over the in-flight claims.
    // D251 — TWO capabilities, not one, and the split is per-match.
    //
    //   `autopilot` (Plus, Pro) — a human approved this batch.
    //   `autopilot-active`        (Pro only)  — the rule acted unattended.
    //
    // A single tier-wide gate cannot express this. Gating the sweep on
    // `autopilot-active` would strand the very batch a Plus user just approved;
    // granting Plus `autopilot-active` would let an `active` rule fire without
    // approval, i.e. hand Plus the thing Pro is sold on. So the sweep is
    // gated only on the review capability, and unattended matches are
    // filtered per-match below on `modeAtMatch`.
    let gatedBy: 'entitlement' | 'quiet' | null = null;
    if (!hasCapability(mailbox.tier, 'autopilot')) {
      gatedBy = 'entitlement';
    }
    const mayActUnattended = hasCapability(mailbox.tier, 'autopilot-active');
    if (!gatedBy && isQuietActive(mailbox.quietState, now)) {
      const resumeAfterMs = msUntilQuietEnds(mailbox.quietState, now);
      console.log(
        JSON.stringify({
          level: 'info',
          kind: 'autopilot.action.quiet_deferred',
          worker: this.workerName,
          mailboxAccountId,
          resumeAfterMs,
        }),
      );
      if (this.deps.onQuietDeferred) {
        try {
          await this.deps.onQuietDeferred(mailboxAccountId, resumeAfterMs);
        } catch (err) {
          console.error(
            JSON.stringify({
              level: 'error',
              kind: 'autopilot.action.quiet_reschedule_failed',
              worker: this.workerName,
              mailboxAccountId,
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      }
      result.deferredQuiet = true;
      gatedBy = 'quiet';
    }

    const loaded = await this.loadEligibleMatches(mailboxAccountId);
    // One batched lookup for the whole sweep, reused by the
    // completion-only filter and by every start-gate inside the loop.
    const inFlightBy = await this.loadInFlightFlags(loaded);

    // Unattended matches on a tier without `autopilot-active` are dropped from
    // NEW work but, like the sweep gates above, never stranded mid-flight:
    // a claim that already mutated Gmail still completes so it gets its
    // Activity row and undo token. This is the path a Pro→Plus downgrade
    // takes, and it must not silently lose a half-applied change.
    const entitledLoaded = mayActUnattended
      ? loaded
      : loaded.filter((m) => m.modeAtMatch === 'observe' || inFlightBy.get(m.matchId));
    const droppedUnattended = loaded.length - entitledLoaded.length;
    if (droppedUnattended > 0) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          kind: 'autopilot.action.unattended_match_not_entitled',
          worker: this.workerName,
          mailboxAccountId,
          tier: mailbox.tier,
          dropped: droppedUnattended,
        }),
      );
    }
    const matches = gatedBy
      ? entitledLoaded.filter((m) => inFlightBy.get(m.matchId))
      : entitledLoaded;
    if (gatedBy && matches.length > 0) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          kind: 'autopilot.action.completing_in_flight_while_gated',
          worker: this.workerName,
          mailboxAccountId,
          gatedBy,
          inFlight: matches.length,
        }),
      );
    }
    result.matchesConsidered = matches.length;
    if (matches.length === 0) {
      result.durationMs = Date.now() - startedAt;
      return result;
    }

    // Guard 4 — protect re-check at execution time, one query for the
    // whole sweep's senders. The same rows feed the already-unsubscribed
    // guard (policy_type='unsubscribe' is the senders-owned projection
    // of a recorded intent).
    const senderKeys = [...new Set(matches.map((m) => m.senderKey))];
    const policyRows = await this.deps.db
      .select({
        senderKey: senderPolicies.senderKey,
        policyType: senderPolicies.policyType,
        isProtected: senderPolicies.isProtected,
      })
      .from(senderPolicies)
      .where(
        and(
          eq(senderPolicies.mailboxAccountId, mailboxAccountId),
          inArray(senderPolicies.senderKey, senderKeys),
        ),
      );
    const shieldedBy = new Map(policyRows.map((r) => [r.senderKey, r.isProtected]));
    const alreadyUnsubscribed = new Set(
      policyRows.filter((r) => r.policyType === 'unsubscribe').map((r) => r.senderKey),
    );

    // Guard 6 — per-rule remaining daily budget (rolling 24h).
    const remainingByRule = new Map<string, number>();

    for (const match of matches) {
      // Guard 3 — rule must still be enabled + not paused (D105).
      // BEFORE every start-gating guard: has this match already moved
      // mail?
      //
      // `resolvedMessageIds` + `status='executing'` are persisted
      // immediately before `batchModify`, so a claim past that point may
      // have mutated Gmail and died before its terminal transaction. The
      // guards below — rule paused, sender newly Protected, daily cap,
      // missing sender row — all answer "should we START this action?".
      // None of them may answer "should we RECORD one that already
      // happened": skipping leaves the change stranded with no Activity
      // row (and a paused rule never retries), and dismissing retires it
      // outright. Either way the user's mail moved, invisibly and
      // unrecoverably. An in-flight claim has exactly one correct
      // outcome — finish it — and it can, because the execution set is
      // persisted Gmail ids and the audit row keys off `senderKey`.
      const inFlight = inFlightBy.get(match.matchId) ?? false;

      if (!inFlight && (!match.ruleEnabled || match.ruleMode === 'paused')) {
        result.skippedRuleInactive += 1;
        continue;
      }
      // Custom rules never execute at V2 (D197/D234) — and an unknown
      // preset key has no cap definition, so fail closed.
      if (!isPresetKey(match.presetKey)) {
        // No preset definition means no cap and no verb semantics, so
        // this one cannot be completed even in flight — surface it
        // rather than silently skipping a possible mutation.
        if (inFlight) {
          console.error(
            JSON.stringify({
              level: 'error',
              kind: 'autopilot.in_flight_claim_unresolvable',
              worker: this.workerName,
              matchId: match.matchId,
              presetKey: match.presetKey,
            }),
          );
        }
        result.skippedRuleInactive += 1;
        continue;
      }

      if (!inFlight && shieldedBy.get(match.senderKey)) {
        await this.dismissShieldedMatch(match, now);
        result.skippedProtected += 1;
        continue;
      }

      if (!match.senderId) {
        // A missing sender row is one of THREE very different things.
        //
        // Normally it is the `building_sender_index` race — the row is
        // coming, so leave the match pending and retry on a later sweep.
        //
        // But once the index has been REBUILT since this match was
        // recorded, the sender's absence is final: the rebuild
        // re-materialises every sender that still has mail, so one that
        // did not come back is gone for good. Retrying that forever is
        // the zombie this worker would otherwise farm — the row survives
        // the rebuild's cleanup because it carries a durable claim, and
        // `MATCH_EVIDENCE_CURRENT` keeps passing it for the same reason,
        // so nothing else would ever retire it. Terminate the match as a
        // no-op (no Gmail change was made, so no undo token) and fail
        // the claim so the abandoned `action_jobs` row is visible rather
        // than sitting at `queued` forever.
        //
        // And before either of those: the claim may already have MUTATED
        // Gmail. `resolvedMessageIds` + `status='executing'` are written
        // immediately BEFORE `batchModify`, so a job past that point may
        // have moved real mail and died before its terminal transaction.
        // Retiring one of those would leave the user's messages archived
        // or trashed with no Activity row and no undo token — the one
        // outcome this product must never produce. Such an action has to
        // finish: the execution set is persisted Gmail message ids and
        // the audit row keys off `senderKey`, so neither needs the
        // senders row the guard is missing. Fall through and complete it.
        if (!inFlight) {
          if (await this.senderIndexRebuiltSince(mailboxAccountId, match.matchId)) {
            await this.abandonStaleClaim(match, now);
            result.abandonedStaleClaim += 1;
            continue;
          }
          result.skippedMissingSender += 1;
          continue;
        }
      }

      // Re-check currency as late as possible. `loadEligibleMatches`
      // already excluded matches a rebuild invalidated, but that read
      // happened before this loop and before any Gmail call — a rebuild
      // committing in between would otherwise get its deleted evidence
      // acted on for real. This narrows the window to the gap between
      // this statement and the mutation; it cannot close it, because an
      // external side effect can never be transactional with a database
      // predicate. `flipMatchApplied` reports the residue.
      if (!inFlight && !(await this.matchStillCurrent(match.matchId))) {
        result.skippedIndexRebuilt += 1;
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
      if (!inFlight && remaining <= 0) {
        // The cap bounds NEW work. An in-flight claim is not new work —
        // holding it back would strand a mutation that already ran.
        result.skippedCapped += 1;
        continue;
      }

      try {
        if (match.actionKind === 'archive' || match.actionKind === 'later') {
          // 'stale' means the rebuild won the race for the claim — the
          // match was invalidated before Gmail was touched.
          if ((await this.executeLabelAction(mailboxAccountId, match, now)) === 'stale') {
            result.skippedIndexRebuilt += 1;
            continue;
          }
          result.labelActionsExecuted += 1;
        } else if (match.actionKind === 'unsubscribe') {
          const outcome = await this.executeUnsubscribeIntent(mailboxAccountId, match, now);
          if (outcome === 'stale') {
            result.skippedIndexRebuilt += 1;
            continue;
          }
          result.unsubscribeIntentsRecorded += 1;
          if (outcome.executionEnqueued) result.unsubscribeExecutionsEnqueued += 1;
        } else {
          // 'keep' (or a future verb) — Autopilot never fires on Keep;
          // a row like this is data drift. Fail closed: skip + log. A
          // claim cannot exist for a verb that never reaches the claim
          // paths, so `inFlight` here would itself be the drift — say so
          // at error level rather than trusting the construction, which
          // is the reasoning that hid two earlier stranding bugs.
          console[inFlight ? 'error' : 'warn'](
            JSON.stringify({
              level: inFlight ? 'error' : 'warn',
              kind: inFlight
                ? 'autopilot.in_flight_claim_unresolvable'
                : 'autopilot.action.unknown_action_kind',
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
   *
   * Excludes matches the initial-sync rebuild invalidated. That rebuild
   * DELETEs and re-inserts `senders`, so a sender row created AFTER the
   * match means the volume / read-rate / recency the rule decided on
   * came from mail this mailbox no longer holds — executing it would
   * mutate Gmail on deleted evidence. The missing-sender case is NOT
   * covered here on purpose: a null `senderId` is the deliberate
   * `building_sender_index` race that `skippedMissingSender` retries on
   * a later sweep, and folding it in would turn a retry into a silent
   * drop. `initial-sync.worker.ts` deletes unexecuted matches inside the
   * rebuild transaction; this predicate covers mailboxes rebuilt before
   * that shipped.
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
        modeAtMatch: ruleMatchLog.modeAtMatch,
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
          MATCH_EVIDENCE_CURRENT,
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
   * A sender that became Protected after the match was logged:
   * never act (D43). The match resolves to `dismissed` — terminal,
   * auditable, and out of the pending sweep.
   */
  private async dismissShieldedMatch(match: EligibleMatch, now: Date): Promise<void> {
    await this.deps.db
      .update(ruleMatchLog)
      .set({ resolution: 'dismissed', resolvedAt: now, dismissReason: 'protected' })
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
  ): Promise<'executed' | 'stale'> {
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
      return 'executed';
    }
    if (!job) {
      const senderId = match.senderId;
      if (!senderId) {
        throw new ValidationError(`match ${match.matchId} has no resolved sender id`);
      }
      // THE serialization point against a sender-index rebuild.
      //
      // This durable row is the claim: once it exists, the rebuild's
      // cleanup leaves the match alone and `matchStillCurrent` keeps
      // returning true, so a half-executed action is never stranded.
      // Creating it under the same per-mailbox lock the rebuild takes,
      // in the same transaction as the currency re-check, is what makes
      // "decide to execute" and "invalidate" mutually exclusive:
      // either the claim commits first and the rebuild respects it, or
      // the rebuild commits first and this check fails BEFORE Gmail is
      // touched. Checking without claiming — which is what this worker
      // did until now — only narrowed the window.
      const claimed = await db.transaction(async (tx) => {
        await lockSenderIndex(tx, mailboxAccountId);
        if (!(await this.matchStillCurrent(match.matchId, tx))) return false;
        await tx
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
            ...(verb === 'later' ? { wakeAt: new Date(defaultLaterWakeAtIso(now)) } : {}),
          })
          .onConflictDoNothing({ target: actionJobs.idempotencyKey });
        return true;
      });
      if (!claimed) return 'stale';
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
      return 'executed';
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

      // The sender-owned Later timer is projected only after Gmail has
      // confirmed the move, matching the manual action pipeline (D245).
      await this.deps.outbox.publish(tx, {
        topic: TOPICS.ACTION_LABEL_APPLIED,
        aggregateId: job.id,
        payload: {
          mailboxAccountId,
          actionId: job.id,
          verb,
          senderKey: match.senderKey,
          undoToken: issued.token,
          affectedCount: ids.length,
          compositeId: job.compositeId,
          wakeAt: verb === 'later' ? (job.wakeAt?.toISOString() ?? null) : null,
          appliedAt: now.toISOString(),
        },
        schema: ActionLabelAppliedPayloadSchema,
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
    return 'executed';
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
  ): Promise<{ executionEnqueued: boolean } | 'stale'> {
    const { db } = this.deps;
    // D248 — the join is a leftJoin and the column is nullable, so a
    // missing method means "the sender index has not derived one", not
    // "this sender publishes no unsubscribe". Collapsing it into 'none'
    // wrote `unsubscribe_unavailable` — "No unsubscribe channel
    // available" — into Activity for a sender nobody ever checked.
    const method = unsubscribeCapabilityOf(match.unsubscribeMethod);
    const executionKey = `autopilot-unsubexec-${match.matchId}`;

    // Unsubscribe records its decision, its execution row and the match
    // flip in ONE transaction, so taking the sender-index lock and
    // re-checking currency here makes "decide to unsubscribe" and
    // "invalidate by rebuild" mutually exclusive — the same serialization
    // the label path gets from its claim. A delivered unsubscribe is
    // one-way (D58), so acting on evidence a rebuild had already deleted
    // is the least recoverable mistake in this worker.
    const executionActionId = await db.transaction(async (tx) => {
      await lockSenderIndex(tx, mailboxAccountId);
      if (!(await this.matchStillCurrent(match.matchId, tx))) return 'stale' as const;
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

      // An outcome row is only written when the capability is KNOWN.
      // `unknown` gets the decision row above and nothing else: there is
      // no outcome to report about a sender we have not checked (D248).
      if (method === 'mailto' || method === 'none') {
        await tx.insert(activityLog).values({
          mailboxAccountId,
          senderKey: match.senderKey,
          source: 'autopilot',
          action: method === 'mailto' ? 'unsubscribe_action_required' : 'unsubscribe_unavailable',
          affectedCount: 0,
          undoToken: null,
          ruleId: match.ruleId,
        });
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
          // `method` is optional on the schema, and the consumer maps a
          // missing one to a NULL lifecycle that leaves the existing
          // status untouched. That is exactly right for `unknown`:
          // sending 'none' would project `unsub_status='unavailable'`
          // and re-tell the lie one layer down (D248).
          ...(method === 'unknown' ? {} : { method }),
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

    if (executionActionId === 'stale') return 'stale';

    // Post-commit enqueue (every producer path's ordering). On enqueue
    // failure the action row flips `failed` so the gap is observable —
    // mirrors `ActionsService.enqueueUnsubExecution`.
    if (executionActionId) {
      try {
        await this.deps.enqueueUnsubExecution({
          actionId: executionActionId,
          mailboxAccountId,
          idempotencyKey: executionKey,
          source: 'autopilot',
          ruleId: match.ruleId,
        });
        return { executionEnqueued: true };
      } catch (err) {
        const failedAt = new Date();
        await db.transaction(async (tx) => {
          const [failedJob] = await tx
            .update(actionJobs)
            .set({ status: 'failed', errorCode: 'ENQUEUE_FAILED', updatedAt: sql`now()` })
            .where(eq(actionJobs.id, executionActionId))
            .returning({ id: actionJobs.id });
          if (failedJob) {
            await tx.insert(activityLog).values({
              mailboxAccountId,
              senderKey: match.senderKey,
              source: 'autopilot',
              action: 'unsubscribe_failed',
              affectedCount: 0,
              undoToken: null,
              ruleId: match.ruleId,
            });
            await this.deps.outbox.publish(tx, {
              topic: TOPICS.ACTIONS_UNSUBSCRIBE_EXECUTED,
              aggregateId: executionActionId,
              payload: {
                mailboxAccountId,
                senderKey: match.senderKey,
                actionId: executionActionId,
                outcome: 'failed',
                httpStatus: null,
                executedAt: failedAt.toISOString(),
              },
              schema: ActionsUnsubscribeExecutedPayloadSchema,
            });
          }
        });
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

  /**
   * Has the sender index been rebuilt since this match was recorded?
   *
   * True when EVERY sender row for the mailbox postdates the match —
   * `InitialSyncWorker` rebuilds by DELETE + re-INSERT, so that is the
   * signature of a full teardown, and it distinguishes "the sender row
   * has not appeared yet" from "the sender did not come back". A
   * mailbox with no sender rows at all counts as rebuilt: there is
   * nothing left for the match to refer to either way.
   *
   * `min` rather than `max`: an ordinary incremental upsert appends
   * newer rows without touching the oldest, so only a rebuild moves it
   * past the match. Same fingerprint `AutopilotApplyWorker` uses.
   */
  private async senderIndexRebuiltSince(
    mailboxAccountId: string,
    matchId: string,
  ): Promise<boolean> {
    const [row] = await this.deps.db
      .select({
        oldestSenderAt: sql<Date | null>`(
          select min(s.created_at)
          from senders s
          where s.mailbox_account_id = ${mailboxAccountId}
        )`,
        matchedAt: ruleMatchLog.matchedAt,
      })
      .from(ruleMatchLog)
      .where(eq(ruleMatchLog.id, matchId))
      .limit(1);
    if (!row) return false;
    if (row.oldestSenderAt == null) return true;
    return new Date(row.oldestSenderAt).getTime() > row.matchedAt.getTime();
  }

  /**
   * May this match already have mutated Gmail?
   *
   * True once its durable claim has advanced past creation — the worker
   * persists `resolvedMessageIds` and flips the row to `executing`
   * immediately BEFORE `batchModify`, precisely so a crashed attempt can
   * re-apply the same set. A `done` claim is excluded: its terminal
   * transaction committed, so the action is already audited and undoable
   * and the normal replay path handles it.
   */
  private async isClaimInFlight(match: EligibleMatch): Promise<boolean> {
    return claimIsInFlight(await this.loadClaim(match));
  }

  /**
   * In-flight flags for a whole sweep in ONE round-trip per chunk.
   *
   * `loadEligibleMatches` is unbounded, so asking per match — which is
   * what the first version of the gated-completion pass did — is an N+1
   * of sequentially awaited queries in front of every sweep. Chunked
   * because the key list is caller-sized and Postgres caps bind
   * parameters.
   */
  private async loadInFlightFlags(matches: EligibleMatch[]): Promise<Map<string, boolean>> {
    const flags = new Map<string, boolean>(matches.map((m) => [m.matchId, false]));
    if (matches.length === 0) return flags;

    const byKey = new Map(matches.map((m) => [claimKey(m), m.matchId]));
    const keys = [...byKey.keys()];
    for (let i = 0; i < keys.length; i += CLAIM_LOOKUP_CHUNK) {
      const rows = await this.deps.db
        .select({
          idempotencyKey: actionJobs.idempotencyKey,
          status: actionJobs.status,
          resolvedMessageIds: actionJobs.resolvedMessageIds,
        })
        .from(actionJobs)
        .where(inArray(actionJobs.idempotencyKey, keys.slice(i, i + CLAIM_LOOKUP_CHUNK)));
      for (const row of rows) {
        const matchId = byKey.get(row.idempotencyKey);
        if (matchId != null) flags.set(matchId, claimIsInFlight(row));
      }
    }
    return flags;
  }

  /** The durable `action_jobs` claim for a match, if one exists. */
  private async loadClaim(
    match: EligibleMatch,
  ): Promise<{ status: string; resolvedMessageIds: string[] } | null> {
    const [row] = await this.deps.db
      .select({ status: actionJobs.status, resolvedMessageIds: actionJobs.resolvedMessageIds })
      .from(actionJobs)
      .where(eq(actionJobs.idempotencyKey, claimKey(match)))
      .limit(1);
    return row ?? null;
  }

  /**
   * Retire a claimed match whose sender is gone for good: the match
   * terminates as a no-op (nothing was mutated, so no undo token) and
   * its durable claim flips to `failed` so an abandoned execution is
   * observable instead of resting at `queued` indefinitely.
   */
  private async abandonStaleClaim(match: EligibleMatch, now: Date): Promise<void> {
    const idempotencyKey = claimKey(match);
    // Defense in depth for the callers: retiring a claim that already
    // touched Gmail would strand an unaudited, unrecoverable mail
    // change. Only a claim that never advanced past creation is safe to
    // drop, so re-assert that here rather than trusting the call site.
    const claim = await this.loadClaim(match);
    if (claim != null && (claim.status !== 'queued' || claim.resolvedMessageIds.length > 0)) {
      throw new ValidationError(
        `refusing to retire claim ${idempotencyKey}: status=${claim.status} resolved=${claim.resolvedMessageIds.length} — it may already have mutated Gmail`,
      );
    }
    await this.deps.db.transaction(async (tx) => {
      await tx
        .update(actionJobs)
        .set({ status: 'failed', errorCode: 'SENDER_INDEX_REBUILT', updatedAt: sql`now()` })
        .where(and(eq(actionJobs.idempotencyKey, idempotencyKey), ne(actionJobs.status, 'done')));
      await tx
        .update(ruleMatchLog)
        .set({ intentApplied: true, resolvedAt: now })
        .where(and(eq(ruleMatchLog.id, match.matchId), eq(ruleMatchLog.intentApplied, false)));
    });
    console.warn(
      JSON.stringify({
        level: 'warn',
        kind: 'autopilot.claim_abandoned_index_rebuilt',
        worker: this.workerName,
        matchId: match.matchId,
        actionKind: match.actionKind,
      }),
    );
  }

  /**
   * Is this match still derived from the CURRENT sender index?
   *
   * Mirrors the `loadEligibleMatches` predicate for a single row, so the
   * two can never drift apart. Called immediately before the Gmail
   * mutation — see the call site for why that narrows the window rather
   * than closing it.
   */
  private async matchStillCurrent(
    matchId: string,
    executor: Pick<WorkerDb, 'select'> = this.deps.db,
  ): Promise<boolean> {
    const [still] = await executor
      .select({ id: ruleMatchLog.id })
      .from(ruleMatchLog)
      .where(
        and(
          eq(ruleMatchLog.id, matchId),
          eq(ruleMatchLog.resolution, 'approved'),
          eq(ruleMatchLog.intentApplied, false),
          MATCH_EVIDENCE_CURRENT,
        ),
      )
      .limit(1);
    return still != null;
  }

  /**
   * Flip a match to executed. Reports — never swallows — the case where
   * the row is already gone.
   */
  private async flipMatchApplied(
    matchId: string,
    undoToken: string | null,
    now: Date,
  ): Promise<void> {
    const flipped = await this.deps.db
      .update(ruleMatchLog)
      .set({ intentApplied: true, intentToken: undoToken, resolvedAt: now })
      .where(and(eq(ruleMatchLog.id, matchId), eq(ruleMatchLog.intentApplied, false)))
      .returning({ id: ruleMatchLog.id });
    if (flipped.length === 0) {
      // The row went terminal or disappeared between load and flip —
      // in practice an `InitialSyncWorker` rebuild committing mid-
      // execution (its cleanup deletes exactly `intent_applied=false`
      // rows, and per-mailbox concurrency is not enforced at the
      // consumer). Gmail HAS already been mutated and the activity +
      // undo rows are written, so this is an audit-linkage gap, not a
      // lost or duplicated action — but it must never pass silently.
      // Postgres protects the other ordering for free: a DELETE whose
      // predicate is `intent_applied=false` re-evaluates after our
      // UPDATE commits and skips the row.
      console.warn(
        JSON.stringify({
          level: 'warn',
          kind: 'autopilot.match_vanished_before_flip',
          worker: this.workerName,
          matchId,
          undoToken,
        }),
      );
    }
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
      .where(senderInboxActionWhere({ mailboxAccountId, senderKeys: [senderKey] }));
    return rows.map((r) => r.providerMessageId);
  }

  /**
   * D81 undo window — Pro+ → 30d; Free/Plus → the column default (7d)
   * via `undefined`. Mirrors `LabelActionWorker.undoExpiresAt` for the
   * archive/later verbs (autopilot never emits `delete`).
   */
  private async undoExpiresAt(mailboxAccountId: string): Promise<Date> {
    const [row] = await this.deps.db
      .select({ tier: workspaces.tier })
      .from(mailboxAccounts)
      .innerJoin(workspaces, eq(workspaces.id, mailboxAccounts.workspaceId))
      .where(eq(mailboxAccounts.id, mailboxAccountId))
      .limit(1);
    // Reads the TIER MANIFEST, like `LabelActionWorker.undoExpiresAt`
    // does. This used to hard-code `['pro','team','enterprise'] -> 30d`
    // and otherwise return `undefined`, leaning on the column default
    // for everyone else — three places encoding one policy, agreeing
    // only by coincidence. They agree today (free/plus 7, pro+ 30); the
    // first manifest change would have made a manual undo and an
    // autopilot undo differ with nothing to catch it.
    return new Date(Date.now() + undoWindowDaysFor(row?.tier ?? 'free') * DAY_MS);
  }
}

const PRESET_KEY_SET = new Set<string>(AUTOPILOT_PRESET_KEYS);
function isPresetKey(k: string | null): k is AutopilotPresetKey {
  return k !== null && PRESET_KEY_SET.has(k);
}
