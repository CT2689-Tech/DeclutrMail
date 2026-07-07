import { and, eq, ne, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import {
  AUTOPILOT_PRESET_KEYS,
  type AutomationRule,
  type AutopilotMatchMode,
  type AutopilotMatchResolution,
  type AutopilotPresetKey,
  automationRules,
  ruleMatchLog,
  type schema,
} from '@declutrmail/db';

import { AUTOPILOT_PRESETS, type PresetInput } from './autopilot-presets.js';
import { materializeAutopilotSignals } from './autopilot-signals.js';
import { BaseDeclutrWorker } from './base-declutr-worker.js';
import { ValidationError } from './worker-errors.js';
import type { WorkerContext } from './worker-context.js';

type WorkerDb = PostgresJsDatabase<typeof schema>;

/**
 * Job payload for one Autopilot apply pass over a mailbox.
 *
 * `triggeredAtMs` is the wall-clock at the trigger event; it forms the
 * BullMQ `jobId` so duplicate adds within the same trigger window are
 * deduped per `perMailboxPolicy` (D203/D225).
 */
export interface AutopilotApplyJobData {
  mailboxAccountId: string;
  triggeredAtMs: number;
}

/** Metrics from one apply pass — logged on `worker.succeeded`. */
export interface AutopilotApplyJobResult {
  /** Number of enabled, non-paused rules that ran. */
  rulesEvaluated: number;
  /**
   * Subset of `rulesEvaluated` whose per-rule body threw mid-loop and
   * was caught. Logged with the rule id + error message; the loop
   * continues to the next rule so one bad rule cannot wreck the
   * whole pass.
   */
  rulesFailed: number;
  /**
   * Subset of `rulesEvaluated` skipped because a stored field was
   * malformed (e.g. `confidence_threshold` not a finite number). The
   * worker logs once per occurrence and continues; a re-sweep after a
   * fix processes the rule normally.
   */
  rulesSkippedMalformed: number;
  /** Total match rows inserted across all rules. */
  matchesWritten: number;
  /** Subset of `matchesWritten` that wrote with `mode_at_match='observe'`. */
  observeMatches: number;
  /** Subset of `matchesWritten` that wrote with `mode_at_match='active'`. */
  activeMatches: number;
  /**
   * Active-mode matches SKIPPED because acting would be a no-op: label
   * verbs (archive/later) with zero INBOX messages for the sender, or
   * an unsubscribe verb for a sender already carrying the one-way
   * `policy_type='unsubscribe'` projection. Without this gate the
   * delta-triggered cadence (D100) re-executes the full match set as
   * 0-affected actions every sweep — unbounded `rule_match_log` /
   * `action_jobs` / `activity_log` growth and an Activity feed full of
   * "archived 0" noise. New mail flips the sender back to actionable
   * (INBOX count > 0), so the D100 re-trigger semantics are preserved.
   * Observe-mode suggestions are NOT gated: the pending-dedup index
   * already bounds them, and a suggestion is meaningful even when the
   * inbox is momentarily clear.
   */
  activeSkippedNotActionable: number;
  /** Senders considered (after the protect-filter). */
  sendersConsidered: number;
  /** Wall-clock ms. */
  durationMs: number;
}

export interface AutopilotApplyDeps {
  db: WorkerDb;
  /** Override clock for tests. Defaults to `() => new Date()`. */
  now?: () => Date;
  /**
   * Optional hook fired after a pass that wrote ≥1 Active-mode match
   * (U14 — D99/D226 execution chain). The composition root wires this
   * to enqueue an `autopilot-action` job so the action consumer
   * executes the auto-approved matches; without it Active-mode rows
   * sit at `intent_applied=false` until the next approve-triggered
   * sweep picks them up.
   *
   * Best-effort: a failure here is logged and swallowed (the action
   * sweep triggered by the next apply pass / user approve is the
   * safety net) — mirrors `InitialSyncDeps.onSenderIndexBuilt`.
   */
  onActiveMatchesPending?: (mailboxAccountId: string) => Promise<void>;
}

/**
 * AutopilotApplyWorker (D99, D100, D101, D102, D104, D105, D124).
 *
 * Runs the V2 preset matchers against every sender in a mailbox and
 * logs matches to `rule_match_log`. Policy: `perMailboxPolicy` per
 * D203/D225 — one in-flight job per mailbox. Idempotency key is
 * `${mailbox}:${triggeredAtMs}` so a Pub/Sub redelivery within the
 * same trigger event is a no-op.
 *
 * What the worker DOES:
 *   - Loads enabled, non-paused rules for the mailbox.
 *   - Materializes the minimal `PresetSignals` for every sender (the
 *     rule set does not need the full cascade signal vector).
 *   - Runs each preset matcher; on match, INSERTs into `rule_match_log`.
 *   - Filters protected senders (`signals.isProtected = true`) BEFORE
 *     matching. Protected senders should never be auto-actioned.
 *   - Updates `automation_rules.last_run_at` + `last_run_actions` +
 *     `last_run_senders` once per rule for the D101 inline summary.
 *
 * What the worker does NOT do:
 *   - Emit Gmail mutations. Active-mode matches write
 *     `(mode_at_match='active', resolution='approved', intent_applied=false,
 *     intent_token=null)`. The action consumer (`AutopilotActionWorker`,
 *     U14) reads `WHERE resolution='approved' AND intent_applied=false`,
 *     creates the `undo_journal` row, emits the Gmail mutation, and
 *     flips `intent_applied=true` with `intent_token`. Splitting the
 *     emission from the matching keeps this worker idempotent on
 *     retry and aligns with the §9 stop-condition that destructive
 *     Gmail actions go through dedicated wiring (D226 lifecycle).
 *     The `onActiveMatchesPending` hook is the chain between the two.
 *
 * Observe vs Active mode handling:
 *   - `mode='observe'` rule → `(mode_at_match='observe', resolution='pending')`.
 *     Sits in the pending-suggestions read path until the user
 *     approves or dismisses.
 *   - `mode='active'`  rule → `(mode_at_match='active', resolution='approved',
 *     intent_applied=false)`. Auto-approved by virtue of Active mode;
 *     the action consumer takes it from there.
 *   - `mode='paused'`  rule → filtered out by `processJob`'s rule load;
 *     the worker never sees the row.
 *
 * Privacy (D7, D228): every read is metadata. The signal materializer
 * touches `senders`, `sender_policies`, `sender_timeseries` (volume +
 * read counts only), and `mail_messages` (`count(*)` only — no body,
 * no snippet). The match log stores `sender_key` (sha256) — never the
 * email itself, never a message id, never any body content.
 */
export class AutopilotApplyWorker extends BaseDeclutrWorker<
  AutopilotApplyJobData,
  AutopilotApplyJobResult
> {
  override readonly workerName = 'AutopilotApplyWorker';
  override readonly policy = 'perMailboxPolicy' as const;

  constructor(private readonly deps: AutopilotApplyDeps) {
    super();
  }

  protected override getIdempotencyKey(payload: AutopilotApplyJobData): string {
    return `${payload.mailboxAccountId}:${payload.triggeredAtMs}`;
  }

  override async processJob(
    payload: AutopilotApplyJobData,
    _ctx: WorkerContext,
  ): Promise<AutopilotApplyJobResult> {
    const startedAt = Date.now();
    const { mailboxAccountId } = payload;
    if (!mailboxAccountId) {
      throw new ValidationError('AutopilotApplyJobData.mailboxAccountId is required');
    }

    const now = (this.deps.now ?? (() => new Date()))();
    const rules = await this.loadEnabledRules(mailboxAccountId);
    if (rules.length === 0) {
      return {
        rulesEvaluated: 0,
        rulesFailed: 0,
        rulesSkippedMalformed: 0,
        matchesWritten: 0,
        observeMatches: 0,
        activeMatches: 0,
        activeSkippedNotActionable: 0,
        sendersConsidered: 0,
        durationMs: Date.now() - startedAt,
      };
    }

    const signalRows = await materializeAutopilotSignals(this.deps.db, mailboxAccountId, now);
    // Protect filter — defense-in-depth even though the cascade also
    // returns 'keep' for protected senders. A rule must NEVER act on
    // a sender the user has marked protected.
    const eligible = signalRows.filter((s) => !s.signals.isProtected);

    let matchesWritten = 0;
    let observeMatches = 0;
    let activeMatches = 0;
    let activeSkippedNotActionable = 0;
    let rulesEvaluated = 0;
    let rulesFailed = 0;
    let rulesSkippedMalformed = 0;

    const presetKeySet = new Set<string>(AUTOPILOT_PRESET_KEYS);
    const isPresetKey = (k: string | null): k is AutopilotPresetKey =>
      k !== null && presetKeySet.has(k);

    for (const rule of rules) {
      // Custom rules (presetKey=NULL) and any future preset keys the
      // worker doesn't know about yet — V2.1 territory; skip per D197.
      if (!isPresetKey(rule.presetKey)) continue;
      const def = AUTOPILOT_PRESETS[rule.presetKey];

      // numeric(3,2) → number. The schema stores a string; the matcher
      // wants a float. `null` means "use the preset default".
      //
      // Defensive: a malformed string (DB corruption, manual UPDATE,
      // future schema migration that loosens the column) would parse
      // to `NaN`, and `confidence <= NaN` is always false — the rule
      // would silently never match. Skip + log + count so the failure
      // is visible in metrics.
      let threshold: number | null = null;
      if (rule.confidenceThreshold !== null) {
        const parsed = Number.parseFloat(rule.confidenceThreshold);
        if (!Number.isFinite(parsed)) {
          rulesSkippedMalformed += 1;
          console.warn(
            JSON.stringify({
              level: 'warn',
              kind: 'autopilot.malformed_threshold',
              worker: this.workerName,
              ruleId: rule.id,
              rawConfidenceThreshold: rule.confidenceThreshold,
            }),
          );
          continue;
        }
        threshold = parsed;
      }
      const modeAtMatch: AutopilotMatchMode = rule.mode === 'active' ? 'active' : 'observe';
      const resolution: AutopilotMatchResolution =
        modeAtMatch === 'active' ? 'approved' : 'pending';

      // Per-rule try/catch — one rule's failure (deadlock, transient
      // DB error, schema drift) must NOT kill the whole apply pass.
      // The next rule still runs; the failed rule's count surfaces on
      // the result envelope so observability sees partial failures.
      try {
        rulesEvaluated += 1;
        const matchesForRule: Array<{ senderKey: string; confidence: number; reason: string }> = [];
        for (const { senderKey, signals, decision, inboxCount, isUnsubscribed } of eligible) {
          const input: PresetInput = { signals, triageDecision: decision };
          const result = def.match(input, threshold);
          if (!result.matched) continue;
          // Active-mode actionability gate (see the
          // `activeSkippedNotActionable` docstring): skip the insert
          // when executing the verb would be a 0-affected no-op.
          // Observe-mode suggestions pass through — the pending-dedup
          // index bounds those.
          if (modeAtMatch === 'active') {
            const actionable = def.actionKind === 'unsubscribe' ? !isUnsubscribed : inboxCount > 0;
            if (!actionable) {
              activeSkippedNotActionable += 1;
              continue;
            }
          }
          // Confidence stored on the match row: the engine's current
          // confidence if a decision row exists; otherwise the rule's
          // threshold (or 0 for non-threshold presets) as a stable default.
          const confidence = decision?.confidence ?? threshold ?? def.defaultThreshold ?? 0;
          matchesForRule.push({ senderKey, confidence, reason: result.reason });
        }

        if (matchesForRule.length > 0) {
          // `onConflictDoNothing` is paired with the partial unique idx
          // `rule_match_log_pending_dedup_uniq` on (rule_id, sender_key)
          // WHERE resolution='pending' (see packages/db migration 0009).
          // Re-runs of the same sweep — cron, manual rescore, retry —
          // become idempotent for unresolved matches: a pending row
          // already in the buffer for (rule, sender) suppresses the
          // duplicate insert instead of flooding the suggestions UI.
          // Per Codex review of PR #65 (finding #3).
          //
          // The `target` + `where` clauses MUST mirror the partial idx
          // exactly — Postgres uses both to identify which unique index
          // backs the conflict clause. Active-mode inserts (resolution
          // = 'approved') are unaffected: the partial idx skips them,
          // so the ON CONFLICT clause is a no-op for those rows.
          const inserted = await this.deps.db
            .insert(ruleMatchLog)
            .values(
              matchesForRule.map((m) => ({
                ruleId: rule.id,
                mailboxAccountId,
                senderKey: m.senderKey,
                matchedAt: now,
                modeAtMatch,
                confidence: m.confidence.toFixed(2),
                reason: m.reason,
                intentApplied: false,
                resolution,
              })),
            )
            .onConflictDoNothing({
              target: [ruleMatchLog.ruleId, ruleMatchLog.senderKey],
              where: sql`${ruleMatchLog.resolution} = 'pending'`,
            })
            .returning({ id: ruleMatchLog.id });
          // Counters reflect ACTUAL inserts so observability can spot a
          // re-run pattern (matchesForRule.length kept growing but
          // matchesWritten flatlined → dedup is firing).
          matchesWritten += inserted.length;
          if (modeAtMatch === 'observe') observeMatches += inserted.length;
          else activeMatches += inserted.length;
        }

        // Update D101 inline-summary fields once per rule, even when zero
        // matches — last_run_at carries "the rule ran" signal for the UI.
        //
        // Match-log insert + rule update are NOT wrapped in a tx: the
        // failure mode is "stale `last_run_at` after a successful match
        // insert" which is benign (the next sweep refreshes it). The
        // opposite ordering (update first, insert second) would risk
        // showing the user a fresh `last_run_at` with no matching rows
        // — strictly worse UX.
        const distinctSenders = new Set(matchesForRule.map((m) => m.senderKey)).size;
        await this.deps.db
          .update(automationRules)
          .set({
            lastRunAt: now,
            lastRunActions: matchesForRule.length,
            lastRunSenders: distinctSenders,
            updatedAt: sql`now()`,
          })
          .where(eq(automationRules.id, rule.id));
      } catch (err) {
        rulesFailed += 1;
        console.error(
          JSON.stringify({
            level: 'error',
            kind: 'autopilot.rule_failed',
            worker: this.workerName,
            ruleId: rule.id,
            mailboxAccountId,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
        // Continue to next rule — partial failure is preferable to
        // total failure for a cron sweep across many rules.
      }
    }

    // Chain to the action consumer when this pass wrote Active-mode
    // matches (auto-approved, `intent_applied=false`). Best-effort —
    // a Redis blip here must not fail an otherwise-successful sweep;
    // the next trigger's sweep is the safety net.
    if (activeMatches > 0 && this.deps.onActiveMatchesPending) {
      try {
        await this.deps.onActiveMatchesPending(mailboxAccountId);
      } catch (err) {
        console.error(
          JSON.stringify({
            level: 'error',
            kind: 'autopilot.action_enqueue_failed',
            worker: this.workerName,
            mailboxAccountId,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }

    return {
      rulesEvaluated,
      rulesFailed,
      rulesSkippedMalformed,
      matchesWritten,
      observeMatches,
      activeMatches,
      activeSkippedNotActionable,
      sendersConsidered: eligible.length,
      durationMs: Date.now() - startedAt,
    };
  }

  /**
   * Enabled, non-paused rules for a mailbox. Custom rules (`is_preset
   * = false`) are accepted by the schema but skipped at runtime per
   * D197 — V2 ships only the preset matchers.
   */
  private async loadEnabledRules(mailboxAccountId: string): Promise<AutomationRule[]> {
    return this.deps.db
      .select()
      .from(automationRules)
      .where(
        and(
          eq(automationRules.mailboxAccountId, mailboxAccountId),
          eq(automationRules.enabled, true),
          ne(automationRules.mode, 'paused'),
          eq(automationRules.isPreset, true),
        ),
      );
  }
}

/** Queue + job name for the Autopilot apply worker (matches the score-worker pattern). */
export const AUTOPILOT_APPLY_QUEUE = 'autopilot-apply';
export const AUTOPILOT_APPLY_JOB = 'autopilot-apply';
