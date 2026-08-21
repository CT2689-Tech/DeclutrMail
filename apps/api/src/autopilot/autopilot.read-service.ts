// apps/api/src/autopilot/autopilot.read-service.ts — Autopilot feature's
// read + lightweight-mutation service (D99-D105, D124, D204, D234).
//
// Owns the SELECTs against `automation_rules` and `rule_match_log`. Also
// performs the small per-row mutations the Autopilot UI needs (toggle
// `enabled`, change `mode`, set `confidence_threshold`, dismiss a
// pending observe-mode suggestion, pause-all). These mutations are NOT
// cross-feature writes — they only touch the Autopilot feature's own
// tables — so they live in the read service per D204's pragmatic
// boundary rather than emitting events.
//
// U14 — the approve flow + dry-run preview now live here too:
//   - `approveMatches` / `approveAllForRule` flip pending Observe-mode
//     rows to `approved` (an intra-feature write on the Autopilot-owned
//     `rule_match_log`) and enqueue an `autopilot-action` sweep — the
//     ACTION CONSUMER (`AutopilotActionWorker`) is the only writer of
//     the Gmail mutation + undo_journal + activity effects (D226).
//   - `previewRule` runs the rule's matcher against the SAME signal
//     materializer the apply worker uses (`materializeAutopilotSignals`)
//     — read-only, no mutation, no match-log writes.
//
// PRIVACY (D7, D228): every column read here is metadata. The match
// log's `sender_key` is the sha256 hex digest, never the raw email.
// The rule's `conditions` + `action_payload` jsonb reference engine
// signals, never message body content.

import {
  BadRequestException,
  Inject,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { Queue } from 'bullmq';

import {
  AUTOPILOT_PRESET_KEYS,
  activityLog,
  type AutopilotPresetKey,
  type AutopilotRuleMode,
  type AutopilotRuleScope,
  actionJobs,
  automationRules,
  mailMessages,
  mailboxAccounts,
  ruleMatchLog,
  workspaces,
  senderPolicies,
  senders,
  triageDecisions,
  undoJournal,
} from '@declutrmail/db';
import {
  AUTOPILOT_ACTION_JOB,
  AUTOPILOT_CLAIM_KEY_PREFIXES,
  AUTOPILOT_PRESETS,
  autopilotActionJobOptions,
  materializeAutopilotSignals,
  type AutopilotActionJobData,
  type PresetInput,
} from '@declutrmail/workers';
import { TIER_IDS, hasCapability } from '@declutrmail/shared/entitlements';
import { AUTOPILOT_PENDING_PAGE_SIZE } from '@declutrmail/shared/contracts';
import type {
  AutopilotApproveResult,
  AutopilotRulePreviewResult,
} from '@declutrmail/shared/contracts';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import type {
  AutopilotMatch,
  AutopilotMatchDismissResult,
  AutopilotObserveDigest,
  AutopilotPauseAllResult,
  AutopilotPatternSuggestion,
  AutopilotPatternSuggestionDecision,
  AutopilotRule,
  AutopilotRulePatch,
} from './autopilot.types.js';

/**
 * NestJS DI token for the `autopilot-action` BullMQ producer queue
 * (U14). Same fail-open `Queue | null` contract as ActionsModule's
 * tokens: `null` when REDIS_URL is unset, and the approve endpoints
 * surface a clear 503 instead of stranding approved-but-never-executed
 * matches.
 */
export const AUTOPILOT_ACTION_QUEUE_TOKEN = 'AUTOPILOT_ACTION_QUEUE';

/** D10 — Observe-mode window before the day-7 prompt (no auto-promote). */
const OBSERVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Preview sample size — D103's "10-row sample list". */
const PREVIEW_SAMPLE_SIZE = 10;

/**
 * A pending suggestion is offerable only while the sender row it was
 * computed FROM is still the one in the index.
 *
 * A match is a claim about a sender's volume, read rate and recency.
 * The initial-sync rebuild tears `senders` down and re-inserts it
 * (`initial-sync.worker.ts` — delete + reinsert IS the reconciliation),
 * so after any resync every surviving match describes mail this mailbox
 * no longer holds. On the founder's dev mailbox, ten days after a
 * reconnect: 6,244 pending matches, of which **32** pointed at sender
 * keys that existed nowhere and **5,978** at rows the rebuild had
 * re-created — only 234 were genuinely current. Existence alone is
 * therefore the wrong test; it catches 0.5% of the bad rows and lets a
 * stale suggestion RESURRECT the instant its sender is re-inserted.
 *
 * `created_at <= matched_at` is the exact test: the sweep reads senders
 * and then writes the match, so a legitimate pair always satisfies it,
 * and incremental sync upserts (`onConflictDoUpdate`) never move
 * `created_at`. Only a full rebuild — the one event that invalidates
 * the evidence — makes it false.
 *
 * `initial-sync.worker.ts` now deletes pending matches inside the same
 * rebuild transaction, so this predicate is the guard for mailboxes
 * that were already rebuilt before that shipped.
 *
 * Written with `sql.raw` on purpose: an interpolated Drizzle column
 * emits a BARE name, which inside this subquery would bind to `s` and
 * degenerate into `s.x = s.x` (see LEARNINGS — correlated-subquery
 * pitfall). The outer table must be named explicitly.
 */
const SENDER_INDEXED_AT_MATCH_TIME: SQL = sql`exists (
  select 1
  from senders s
  where s.mailbox_account_id = ${sql.raw('rule_match_log.mailbox_account_id')}
    and s.sender_key = ${sql.raw('rule_match_log.sender_key')}
    and s.created_at <= ${sql.raw('rule_match_log.matched_at')}
)`;

/** D246 repeated-decision evidence and dismissal windows. */
const PATTERN_EVIDENCE_WINDOW_DAYS = 30;
const PATTERN_EVIDENCE_MIN_SENDERS = 3;
const PATTERN_PRESET_KEYS = ['auto_archive_low_engagement', 'auto_unsubscribe_noisy'] as const;

/**
 * `'<prefix>' || rule_match_log.id::text` for each exported worker
 * claim-key prefix — the correlated forms the D251 demotion matches
 * `action_jobs.idempotency_key` against. Built from
 * `AUTOPILOT_CLAIM_KEY_PREFIXES` so the SQL cannot drift from
 * `claimKey` in the action worker.
 */
function claimKeySqlForms(): SQL {
  return sql.join(
    AUTOPILOT_CLAIM_KEY_PREFIXES.map((p) => sql`${p} || ${sql.raw('rule_match_log.id')}::text`),
    sql`, `,
  );
}

@Injectable()
export class AutopilotReadService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    @Optional()
    @Inject(AUTOPILOT_ACTION_QUEUE_TOKEN)
    private readonly actionQueue: Queue<AutopilotActionJobData> | null = null,
  ) {}

  /**
   * List all rules for a mailbox. Returns rows in creation order
   * (matches the seeded preset order: #1..#5). The page is small
   * (5 presets at V2 launch; ~10 once custom rules unlock per D197),
   * so no pagination yet — a future PR adds it if needed.
   */
  async listRules(mailboxAccountId: string): Promise<AutopilotRule[]> {
    const rows = await this.db
      .select()
      .from(automationRules)
      .where(eq(automationRules.mailboxAccountId, mailboxAccountId))
      .orderBy(automationRules.createdAt, automationRules.id);
    const digests = await this.observeDigests(mailboxAccountId);
    return rows.map((r) => projectRule(r, digests.get(r.id) ?? null));
  }

  /** Get one rule by id within a mailbox. Returns `null` on miss (controller maps to 404). */
  async getRule(mailboxAccountId: string, id: string): Promise<AutopilotRule | null> {
    const [row] = await this.db
      .select()
      .from(automationRules)
      .where(
        and(eq(automationRules.mailboxAccountId, mailboxAccountId), eq(automationRules.id, id)),
      )
      .limit(1);
    if (!row) return null;
    const digests = await this.observeDigests(mailboxAccountId, id);
    return projectRule(row, digests.get(row.id) ?? null);
  }

  /**
   * D246 — derive at most one repeated manual-decision opportunity.
   *
   * Evidence is bounded to 30 days and distinct senders. The current
   * triage verdict must satisfy the exact threshold-bearing preset,
   * protected senders and reverted decisions are excluded, and only a
   * disabled account-scoped rule can be proposed. No sender identity
   * leaves this aggregate query.
   */
  async getPatternSuggestion(mailboxAccountId: string): Promise<AutopilotPatternSuggestion | null> {
    const cutoff = new Date(Date.now() - PATTERN_EVIDENCE_WINDOW_DAYS * 86_400_000).toISOString();
    const dismissedCutoff = cutoff;
    const evidenceCount = sql<number>`count(distinct ${activityLog.senderKey})::int`;
    const [row] = await this.db
      .select({
        ruleId: automationRules.id,
        presetKey: automationRules.presetKey,
        ruleName: automationRules.name,
        actionKind: automationRules.actionKind,
        evidenceCount,
      })
      .from(automationRules)
      .innerJoin(
        activityLog,
        and(
          eq(activityLog.mailboxAccountId, automationRules.mailboxAccountId),
          sql`${activityLog.action}::text = ${automationRules.actionKind}::text`,
        ),
      )
      .innerJoin(
        triageDecisions,
        and(
          eq(triageDecisions.mailboxAccountId, activityLog.mailboxAccountId),
          eq(triageDecisions.senderKey, activityLog.senderKey),
          sql`${triageDecisions.verdict}::text = ${automationRules.actionKind}::text`,
          // A NULL stored threshold means "use the preset default" at
          // runtime. Keep pattern evidence aligned with the apply worker's
          // effective threshold so resetting a rule cannot accidentally
          // make every confidence eligible (SQL comparisons with NULL are
          // otherwise unknown).
          sql`${triageDecisions.confidence} > coalesce(
            ${automationRules.confidenceThreshold},
            case ${automationRules.presetKey}
              when 'auto_archive_low_engagement' then cast(${AUTOPILOT_PRESETS.auto_archive_low_engagement.defaultThreshold} as numeric)
              when 'auto_unsubscribe_noisy' then cast(${AUTOPILOT_PRESETS.auto_unsubscribe_noisy.defaultThreshold} as numeric)
              else null
            end
          )`,
        ),
      )
      .leftJoin(
        senderPolicies,
        and(
          eq(senderPolicies.mailboxAccountId, activityLog.mailboxAccountId),
          eq(senderPolicies.senderKey, activityLog.senderKey),
        ),
      )
      .leftJoin(
        undoJournal,
        and(
          eq(undoJournal.token, activityLog.undoToken),
          eq(undoJournal.mailboxAccountId, activityLog.mailboxAccountId),
        ),
      )
      .where(
        and(
          eq(automationRules.mailboxAccountId, mailboxAccountId),
          eq(automationRules.isPreset, true),
          eq(automationRules.enabled, false),
          eq(automationRules.scope, 'account'),
          inArray(automationRules.presetKey, [...PATTERN_PRESET_KEYS]),
          sql`(${automationRules.patternSuggestionDismissedAt} is null or ${automationRules.patternSuggestionDismissedAt} <= ${dismissedCutoff}::timestamptz)`,
          ne(activityLog.source, 'autopilot'),
          sql`${activityLog.senderKey} is not null`,
          sql`${activityLog.occurredAt} >= ${cutoff}::timestamptz`,
          sql`${activityLog.occurredAt} <= now()`,
          sql`coalesce(${senderPolicies.isProtected}, false) = false`,
          sql`${activityLog.revertedAt} is null`,
          sql`(${activityLog.undoToken} is null or ${undoJournal.revertedAt} is null)`,
          // Count only the sender's latest valid user-directed canonical
          // decision. An older Archive must not remain evidence after a
          // later Keep/Delete or another changed decision.
          sql`${activityLog.id} = (
            select latest.id
            from activity_log latest
            left join undo_journal latest_undo
              on latest_undo.token = latest.undo_token
             and latest_undo.mailbox_account_id = latest.mailbox_account_id
            where latest.mailbox_account_id = ${mailboxAccountId}
              and latest.sender_key = ${activityLog.senderKey}
              and latest.occurred_at >= ${cutoff}::timestamptz
              and latest.occurred_at <= now()
              and latest.source <> 'autopilot'
              and latest.action in ('keep','archive','unsubscribe','later','delete')
              and latest.reverted_at is null
              and (latest.undo_token is null or latest_undo.reverted_at is null)
            order by latest.occurred_at desc, latest.id desc
            limit 1
          )`,
        ),
      )
      .groupBy(
        automationRules.id,
        automationRules.presetKey,
        automationRules.name,
        automationRules.actionKind,
      )
      .having(sql`${evidenceCount} >= ${PATTERN_EVIDENCE_MIN_SENDERS}`)
      .orderBy(sql`${evidenceCount} desc`, automationRules.presetKey)
      .limit(1);

    if (
      !row ||
      (row.presetKey !== 'auto_archive_low_engagement' &&
        row.presetKey !== 'auto_unsubscribe_noisy') ||
      (row.actionKind !== 'archive' && row.actionKind !== 'unsubscribe')
    ) {
      return null;
    }
    return {
      ruleId: row.ruleId,
      presetKey: row.presetKey,
      ruleName: row.ruleName,
      actionKind: row.actionKind,
      scope: 'account',
      evidenceCount: row.evidenceCount,
      evidenceWindowDays: PATTERN_EVIDENCE_WINDOW_DAYS,
      dailyActionCap: AUTOPILOT_PRESETS[row.presetKey].dailyActionCap,
    };
  }

  /** Accept into Observe or dismiss the one currently eligible suggestion. */
  async decidePatternSuggestion(
    mailboxAccountId: string,
    ruleId: string,
    decision: 'observe' | 'dismissed',
  ): Promise<AutopilotPatternSuggestionDecision | null> {
    const current = await this.getPatternSuggestion(mailboxAccountId);
    if (!current || current.ruleId !== ruleId) return null;
    const dismissedCutoff = new Date(
      Date.now() - PATTERN_EVIDENCE_WINDOW_DAYS * 86_400_000,
    ).toISOString();

    const set: Record<string, unknown> = { updatedAt: sql`now()` };
    if (decision === 'observe') {
      set.enabled = true;
      set.mode = 'observe';
      set.modeChangedAt = sql`now()`;
      set.observePromptDismissedAt = null;
      set.patternSuggestionDismissedAt = null;
    } else {
      set.patternSuggestionDismissedAt = sql`now()`;
    }
    const [updated] = await this.db
      .update(automationRules)
      .set(set)
      .where(
        and(
          eq(automationRules.id, ruleId),
          eq(automationRules.mailboxAccountId, mailboxAccountId),
          eq(automationRules.isPreset, true),
          eq(automationRules.enabled, false),
          eq(automationRules.scope, 'account'),
          inArray(automationRules.presetKey, [...PATTERN_PRESET_KEYS]),
          sql`(${automationRules.patternSuggestionDismissedAt} is null or ${automationRules.patternSuggestionDismissedAt} <= ${dismissedCutoff}::timestamptz)`,
        ),
      )
      .returning({ id: automationRules.id });
    return updated
      ? {
          ruleId: updated.id,
          presetKey: current.presetKey,
          decision,
          evidenceCount: current.evidenceCount,
          decidedAt: new Date().toISOString(),
        }
      : null;
  }

  /**
   * D10/D101 — per-rule Observe-mode digest, one grouped query for the
   * mailbox. For every rule with Observe-mode match history:
   *
   *   - `pendingTotal` — all pending Observe rows (uncapped; the
   *     honest gate for the day-7 prompt, unlike the 50-row page).
   *   - `senders7d`    — distinct senders matched in the last 7 days.
   *   - `inboxMessagesNow` — INBOX messages those senders hold RIGHT NOW
   *     (LEFT JOIN mail_messages, same resolution the action sweep
   *     uses). NOT windowed, deliberately: `recent` bounds
   *     `rule_match_log.matched_at`, and the join carries no
   *     `internal_date` predicate, so a sender who matched once
   *     yesterday contributes its entire current inbox backlog however
   *     old. That is the right number — it is what a sweep now would act
   *     on — but it is not a 7-day figure, and the field was called
   *     `messages7d` until 2026-08-21, which is how the rule card came
   *     to render it as "would have archived N emails in the last 7
   *     days" on the very screen where a user decides whether to hand a
   *     rule unattended archive/delete power.
   *
   * Resolved rows remain evidence for the 7-day totals. The message id
   * count is distinct so repeated matches for one resolved sender do
   * not duplicate its current INBOX messages.
   * Metadata only (D7): counts of ids, never content.
   */
  private async observeDigests(
    mailboxAccountId: string,
    ruleId?: string,
  ): Promise<Map<string, AutopilotObserveDigest>> {
    const cutoff = new Date(Date.now() - OBSERVE_WINDOW_MS).toISOString();
    const recent: SQL = sql`${ruleMatchLog.matchedAt} >= ${cutoff}::timestamptz`;
    const pending: SQL = sql`${ruleMatchLog.resolution} = 'pending'`;
    const rows = await this.db
      .select({
        ruleId: ruleMatchLog.ruleId,
        pendingTotal: sql<number>`count(distinct ${ruleMatchLog.id}) filter (where ${pending} and ${SENDER_INDEXED_AT_MATCH_TIME})::int`,
        senders7d: sql<number>`count(distinct ${ruleMatchLog.senderKey}) filter (where ${recent})::int`,
        inboxMessagesNow: sql<number>`count(distinct ${mailMessages.id}) filter (where ${recent})::int`,
      })
      .from(ruleMatchLog)
      .leftJoin(
        mailMessages,
        and(
          eq(mailMessages.mailboxAccountId, ruleMatchLog.mailboxAccountId),
          eq(mailMessages.senderKey, ruleMatchLog.senderKey),
          // `is_outbound = false` — this preview counts what an observe-
          // mode rule WOULD move, and the executor resolves that set
          // through `senderInboxActionWhere`, which excludes the user's
          // own sent mail. Without it the number promised more than the
          // action could deliver.
          eq(mailMessages.isOutbound, false),
          sql`'INBOX' = ANY(${mailMessages.labelIds})`,
        ),
      )
      .where(
        and(
          eq(ruleMatchLog.mailboxAccountId, mailboxAccountId),
          eq(ruleMatchLog.modeAtMatch, 'observe'),
          ...(ruleId ? [eq(ruleMatchLog.ruleId, ruleId)] : []),
        ),
      )
      .groupBy(ruleMatchLog.ruleId);
    return new Map(
      rows.map((r) => [
        r.ruleId,
        {
          pendingTotal: r.pendingTotal,
          senders7d: r.senders7d,
          inboxMessagesNow: r.inboxMessagesNow,
        },
      ]),
    );
  }

  /**
   * PATCH a rule's user-controlled fields (enabled, mode, threshold,
   * scope). Returns the updated row, or `null` if no row matches the
   * `(mailboxAccountId, id)` pair.
   *
   * Mode transitions reset `mode_changed_at` so the 7-day Observe →
   * Active auto-promotion timer (future cron) starts from the user's
   * action, not the original `created_at`.
   *
   * D234 — custom rules (is_preset=false) are accepted by the schema
   * but the API rejects PATCH on them at V2. The check uses
   * `is_preset=true` in the WHERE so a custom-rule id is treated as a
   * miss and returns null → 404. This keeps the V2 surface area
   * focused on presets without leaking is_preset=false rows.
   */
  async patchRule(
    mailboxAccountId: string,
    id: string,
    patch: AutopilotRulePatch,
  ): Promise<AutopilotRule | null> {
    if (
      patch.enabled === undefined &&
      patch.mode === undefined &&
      patch.confidenceThreshold === undefined &&
      patch.scope === undefined &&
      patch.observePromptDismissed === undefined
    ) {
      // Nothing to update — surface as a client error so the FE
      // catches the empty-patch bug at the boundary.
      throw new BadRequestException('PATCH body must update at least one field.');
    }
    if (patch.confidenceThreshold !== undefined && patch.confidenceThreshold !== null) {
      const c = patch.confidenceThreshold;
      if (!Number.isFinite(c) || c < 0 || c > 1) {
        throw new BadRequestException('confidenceThreshold must be a finite number in [0, 1].');
      }
    }

    // Drizzle's update().set() accepts `SQL` for any column on the
    // Postgres dialect; `$inferInsert` narrows too aggressively to
    // Date for the timestamp columns. Loosen the index signature to
    // `unknown` so the `sql\`now()\`` expressions for `updatedAt` and
    // `modeChangedAt` typecheck without an unsafe cast.
    const set: Record<string, unknown> = { updatedAt: sql`now()` };
    if (patch.enabled !== undefined) set.enabled = patch.enabled;
    if (patch.mode !== undefined) {
      set.mode = patch.mode;
      // Reset the Observe-window timer on any mode transition — and
      // re-arm the day-7 prompt (D10): a fresh window earns a fresh
      // prompt. An explicit `observePromptDismissed` below overrides.
      set.modeChangedAt = sql`now()`;
      set.observePromptDismissedAt = null;
    }
    if (patch.confidenceThreshold !== undefined) {
      set.confidenceThreshold =
        patch.confidenceThreshold === null ? null : patch.confidenceThreshold.toFixed(2);
      // Moving the gate re-enters Observe (founder decision 2026-08-20).
      // A threshold change silently redefines what an `active` rule
      // acts on — lower it and the rule starts archiving or
      // unsubscribing senders it would not have touched a moment ago,
      // unattended, with no preview and nothing in the UI marking the
      // change as consequential. Observe turns the widened set into
      // suggestions the user approves.
      //
      // ONLY from `active`. A `paused` rule is an explicit "stop" the
      // user set, and editing a number must not quietly restart it; a
      // rule already in `observe` has nothing to move to, and resetting
      // its window would restart the 7-day countdown and re-arm the
      // day-7 prompt for no reason. The CASE reads the row's CURRENT
      // mode inside the UPDATE, so this stays one statement. An
      // explicit `mode` in the SAME patch wins — the user said what
      // they wanted.
      if (patch.mode === undefined) {
        const wasActive = sql`${automationRules.mode} = 'active'`;
        set.mode = sql`CASE WHEN ${wasActive} THEN 'observe'::autopilot_rule_mode ELSE ${automationRules.mode} END`;
        set.modeChangedAt = sql`CASE WHEN ${wasActive} THEN now() ELSE ${automationRules.modeChangedAt} END`;
        set.observePromptDismissedAt = sql`CASE WHEN ${wasActive} THEN NULL ELSE ${automationRules.observePromptDismissedAt} END`;
      }
    }
    if (patch.scope !== undefined) set.scope = patch.scope;
    if (patch.observePromptDismissed !== undefined) {
      set.observePromptDismissedAt = patch.observePromptDismissed ? sql`now()` : null;
    }

    const [updated] = await this.db
      .update(automationRules)
      .set(set)
      .where(
        and(
          eq(automationRules.mailboxAccountId, mailboxAccountId),
          eq(automationRules.id, id),
          eq(automationRules.isPreset, true),
        ),
      )
      .returning();
    if (!updated) return null;
    const digests = await this.observeDigests(mailboxAccountId, id);
    return projectRule(updated, digests.get(updated.id) ?? null);
  }

  /**
   * D105 — pause-all. Flips every non-paused rule for the mailbox to
   * `mode='paused'`. Returns the count of rules that actually changed
   * state (already-paused rules are skipped via the WHERE clause).
   */
  async pauseAll(mailboxAccountId: string): Promise<AutopilotPauseAllResult> {
    const updated = await this.db
      .update(automationRules)
      .set({ mode: 'paused', modeChangedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          eq(automationRules.mailboxAccountId, mailboxAccountId),
          ne(automationRules.mode, 'paused'),
        ),
      )
      .returning({ id: automationRules.id });
    return { pausedCount: updated.length };
  }

  /**
   * D251 Pro→Plus downgrade — called by the billing tier writers (via
   * this module's exported facade; billing never touches
   * `automation_rules` directly, D204) whenever a workspace's new tier
   * no longer grants `autopilot-active`:
   *
   *   1. Every `active` rule flips back to `observe`, with the same
   *      field semantics as a user mode change in `patchRule` (fresh
   *      Observe window, re-armed day-7 prompt). Stored state stays
   *      honest instead of relying on the worker guards to silently
   *      refuse — the plan's CORRECTION 2026-08-02 rejects
   *      worker-refusal-only explicitly.
   *   2. Auto-approved `active`-provenance matches that never applied
   *      (`resolution='approved', intent_applied=false`) are dismissed
   *      with `dismiss_reason='entitlement'`. Left approved they would
   *      re-arm: a later re-upgrade would execute months-stale matches
   *      under a rule this very method set back to Observe.
   *
   * Matches whose claim is IN FLIGHT are deliberately excluded — a
   * claim that already mutated Gmail must complete its bookkeeping
   * (Activity row + undo token), never be relabelled dismissed. The
   * predicate mirrors the action worker's `claimIsInFlight`: a claim
   * still `queued` with an empty resolved set never touched Gmail, so
   * its match IS dismissed and the orphaned claim flips to `failed`
   * (the `abandonStaleClaim` pattern) — excluding those rows left them
   * `approved, intent_applied=false` forever, primed to execute on a
   * re-upgrade (arch-gate finding, 2026-08-04). Claim keys build from
   * the worker's exported `AUTOPILOT_CLAIM_KEY_PREFIXES`, so the two
   * sides cannot drift. A sweep already in flight during the downgrade
   * can still claim a just-dismissed row; its completion only flips
   * `intent_applied`/`intent_token`, so the row stays consistent and
   * the applied action keeps its undo path.
   *
   * SELF-ENFORCING: reads the workspace's CURRENT tier through the
   * same executor and no-ops when it grants `autopilot-active`, so a
   * future caller cannot strip Active rules from a paying Pro
   * workspace by forgetting the check. Accepts the caller's
   * transaction so the demotion commits atomically with the tier
   * write (the webhook path passes its tx and therefore sees the tier
   * value it just wrote). Idempotent.
   */
  async demoteUnattendedRules(
    workspaceId: string,
    executor: Pick<DrizzleDb, 'update' | 'select'> = this.db,
  ): Promise<{ demotedRules: number; neutralizedMatches: number }> {
    const [ws] = await executor
      .select({ tier: workspaces.tier })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    if (!ws || hasCapability(ws.tier, 'autopilot-active')) {
      return { demotedRules: 0, neutralizedMatches: 0 };
    }

    const workspaceMailboxIds = executor
      .select({ id: mailboxAccounts.id })
      .from(mailboxAccounts)
      .where(eq(mailboxAccounts.workspaceId, workspaceId));

    const demoted = await executor
      .update(automationRules)
      .set({
        mode: 'observe',
        modeChangedAt: sql`now()`,
        observePromptDismissedAt: null,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(automationRules.mode, 'active'),
          inArray(automationRules.mailboxAccountId, workspaceMailboxIds),
        ),
      )
      .returning({ id: automationRules.id });

    const neutralized = await executor
      .update(ruleMatchLog)
      .set({
        resolution: 'dismissed',
        resolvedAt: sql`now()`,
        dismissReason: 'entitlement',
      })
      .where(
        and(
          eq(ruleMatchLog.modeAtMatch, 'active'),
          eq(ruleMatchLog.resolution, 'approved'),
          eq(ruleMatchLog.intentApplied, false),
          inArray(ruleMatchLog.mailboxAccountId, workspaceMailboxIds),
          // Exclude only claims that are IN FLIGHT (the action worker's
          // `claimIsInFlight`): anything past `queued`, or a queued
          // claim that already resolved message ids. One DELIBERATE
          // divergence: the worker treats `done` as not-in-flight so a
          // crashed completion can finish its bookkeeping; here a
          // `done` claim still blocks dismissal — the action ran, so
          // relabelling its match dismissed would falsify the audit. Correlated
          // column MUST be table-qualified via sql.raw — a
          // `${ruleMatchLog.id}` here emits a bare `id` that resolves
          // against action_jobs (the SENDER_FIRST_SEEN precedent above).
          sql`NOT EXISTS (
            SELECT 1 FROM ${actionJobs}
            WHERE ${actionJobs.idempotencyKey} IN (${claimKeySqlForms()})
              AND (${actionJobs.status} <> 'queued'
                   OR cardinality(${actionJobs.resolvedMessageIds}) > 0)
          )`,
        ),
      )
      .returning({ id: ruleMatchLog.id });

    // Orphaned never-advanced claims of the matches just dismissed flip
    // to `failed` (the worker's `abandonStaleClaim` pattern) so a BullMQ
    // replay finds a terminal row, not a resurrectable queued one. The
    // WHERE re-asserts the never-touched-Gmail condition rather than
    // trusting the exclusion above — same defense the worker uses.
    if (neutralized.length > 0) {
      await executor
        .update(actionJobs)
        .set({ status: 'failed', errorCode: 'ENTITLEMENT_DEMOTED', updatedAt: sql`now()` })
        .where(
          and(
            inArray(
              actionJobs.idempotencyKey,
              neutralized.flatMap((r) => AUTOPILOT_CLAIM_KEY_PREFIXES.map((p) => `${p}${r.id}`)),
            ),
            eq(actionJobs.status, 'queued'),
            sql`cardinality(${actionJobs.resolvedMessageIds}) = 0`,
          ),
        );
    }

    if (demoted.length > 0 || neutralized.length > 0) {
      console.log(
        JSON.stringify({
          level: 'info',
          kind: 'autopilot.rules.demoted_on_downgrade',
          workspaceId,
          demotedRules: demoted.length,
          neutralizedMatches: neutralized.length,
        }),
      );
    }
    return { demotedRules: demoted.length, neutralizedMatches: neutralized.length };
  }

  /**
   * D251 global self-heal — demote every workspace whose CURRENT tier
   * does not grant `autopilot-active` (list derived from the manifest).
   * The reconciliation sweep calls this 6-hourly: the webhook path
   * demotes atomically with its tier write, but an apply sweep already
   * in flight during a downgrade can insert active-provenance matches
   * AFTER that demotion, and rows can drift in through any other tier
   * writer — this pass is what converges them. Loops the per-workspace
   * facade rather than mirroring its SQL, so the demotion semantics
   * have exactly one implementation (D204; arch-gate 2026-08-04) and
   * every converged workspace gets its own log line.
   */
  async demoteUnattendedRulesForUnentitledTiers(): Promise<{
    demotedRules: number;
    neutralizedMatches: number;
    workspaces: number;
  }> {
    const unentitledTiers = TIER_IDS.filter((t) => !hasCapability(t, 'autopilot-active'));
    const ruleWs = await this.db
      .selectDistinct({ wsId: mailboxAccounts.workspaceId })
      .from(mailboxAccounts)
      .innerJoin(workspaces, eq(workspaces.id, mailboxAccounts.workspaceId))
      .innerJoin(automationRules, eq(automationRules.mailboxAccountId, mailboxAccounts.id))
      .where(and(inArray(workspaces.tier, unentitledTiers), eq(automationRules.mode, 'active')));
    const matchWs = await this.db
      .selectDistinct({ wsId: mailboxAccounts.workspaceId })
      .from(mailboxAccounts)
      .innerJoin(workspaces, eq(workspaces.id, mailboxAccounts.workspaceId))
      .innerJoin(ruleMatchLog, eq(ruleMatchLog.mailboxAccountId, mailboxAccounts.id))
      .where(
        and(
          inArray(workspaces.tier, unentitledTiers),
          eq(ruleMatchLog.modeAtMatch, 'active'),
          eq(ruleMatchLog.resolution, 'approved'),
          eq(ruleMatchLog.intentApplied, false),
        ),
      );
    const wsIds = [...new Set([...ruleWs, ...matchWs].map((r) => r.wsId))];
    let demotedRules = 0;
    let neutralizedMatches = 0;
    for (const wsId of wsIds) {
      // Each workspace converges in ITS OWN transaction (arch-gate
      // 2026-08-04): without one, a crash between the match dismissal
      // and the orphan-claim flip leaves a dismissed match with a live
      // queued claim — a state the discovery predicate above
      // (`resolution='approved'`) never revisits, so it would sit in
      // Activity as a queued action forever.
      const out = await this.db.transaction((tx) => this.demoteUnattendedRules(wsId, tx));
      demotedRules += out.demotedRules;
      neutralizedMatches += out.neutralizedMatches;
    }
    return { demotedRules, neutralizedMatches, workspaces: wsIds.length };
  }

  /**
   * D104 — pending suggestions for the Autopilot screen. Returns the
   * Observe-mode matches awaiting user decision, newest first. Uses
   * the partial index `rule_match_log_observe_pending_idx`.
   *
   * Page size is fixed at 50 — the Autopilot UI shows a list, not an
   * infinite feed. Cursoring would land if the backlog ever needs it.
   */
  async listPendingSuggestions(mailboxAccountId: string): Promise<AutopilotMatch[]> {
    const PAGE_SIZE = AUTOPILOT_PENDING_PAGE_SIZE;
    // LEFT JOIN senders so each match carries the sender's display name +
    // email (D7 allowlist — sender identity is the FIRST item on the
    // storage list; surfacing it is NOT a privacy violation). LEFT join
    // because `building_sender_index` may not have materialised the row
    // yet — the FE falls back to the senderKey hash in that race window
    // (FOUNDER 2026-06-06 smoke — the Autopilot UI shipped hash-only and
    // was unreadable to the user).
    const rows = await this.db
      .select({
        match: ruleMatchLog,
        senderDisplayName: senders.displayName,
        senderEmail: senders.email,
      })
      .from(ruleMatchLog)
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
          eq(ruleMatchLog.modeAtMatch, 'observe'),
          eq(ruleMatchLog.resolution, 'pending'),
          SENDER_INDEXED_AT_MATCH_TIME,
        ),
      )
      .orderBy(desc(ruleMatchLog.matchedAt), desc(ruleMatchLog.id))
      .limit(PAGE_SIZE);
    return rows.map((r) =>
      projectMatch(r.match, { senderName: r.senderDisplayName, senderEmail: r.senderEmail }),
    );
  }

  /**
   * List recent matches for a specific rule (D101 last-N mini-list).
   * Newest first, default 10 rows.
   */
  async listMatchesForRule(
    mailboxAccountId: string,
    ruleId: string,
    limit = 10,
  ): Promise<AutopilotMatch[] | null> {
    // Verify the rule exists in this mailbox before reading its
    // matches — collapses cross-tenant lookups to 404.
    const [rule] = await this.db
      .select({ id: automationRules.id })
      .from(automationRules)
      .where(
        and(eq(automationRules.mailboxAccountId, mailboxAccountId), eq(automationRules.id, ruleId)),
      )
      .limit(1);
    if (!rule) return null;

    const rows = await this.db
      .select({
        match: ruleMatchLog,
        senderDisplayName: senders.displayName,
        senderEmail: senders.email,
      })
      .from(ruleMatchLog)
      .leftJoin(
        senders,
        and(
          eq(senders.mailboxAccountId, ruleMatchLog.mailboxAccountId),
          eq(senders.senderKey, ruleMatchLog.senderKey),
        ),
      )
      .where(
        and(eq(ruleMatchLog.mailboxAccountId, mailboxAccountId), eq(ruleMatchLog.ruleId, ruleId)),
      )
      .orderBy(desc(ruleMatchLog.matchedAt), desc(ruleMatchLog.id))
      .limit(Math.max(1, Math.min(50, limit)));
    return rows.map((r) =>
      projectMatch(r.match, { senderName: r.senderDisplayName, senderEmail: r.senderEmail }),
    );
  }

  /**
   * D104 — dismiss a pending Observe-mode suggestion. Flips
   * `resolution = 'dismissed'` and sets `resolved_at`.
   *
   * Idempotency contract (D202/D207, Phase 1):
   *
   *   - First dismiss              → returns `{ alreadyDismissed: false }`
   *   - Repeat dismiss of the same → returns `{ alreadyDismissed: true }`
   *                                   (200, terminal state echoed)
   *   - Cross-tenant / not-observe → returns `null` → controller 404
   *                                   (cannot probe existence across mailboxes)
   *
   * The repeat-dismiss case used to return `null` → 404, which made a
   * flaky-network retry indistinguishable from "match never existed".
   * The follow-up query keeps the tenancy boundary intact (it filters
   * by `mailboxAccountId`) while letting the client render success on
   * a benign replay.
   */
  async dismissMatch(
    mailboxAccountId: string,
    matchId: string,
  ): Promise<AutopilotMatchDismissResult | null> {
    const [updated] = await this.db
      .update(ruleMatchLog)
      .set({ resolution: 'dismissed', resolvedAt: sql`now()`, dismissReason: 'user' })
      .where(
        and(
          eq(ruleMatchLog.mailboxAccountId, mailboxAccountId),
          eq(ruleMatchLog.id, matchId),
          // Only Observe-mode pending matches can be dismissed. Active
          // matches already auto-approved; dismissed matches are
          // terminal already and handled by the follow-up SELECT.
          eq(ruleMatchLog.modeAtMatch, 'observe'),
          eq(ruleMatchLog.resolution, 'pending'),
        ),
      )
      .returning({ resolution: ruleMatchLog.resolution, resolvedAt: ruleMatchLog.resolvedAt });
    if (updated) {
      return {
        resolution: updated.resolution,
        resolvedAt: updated.resolvedAt?.toISOString() ?? new Date().toISOString(),
        alreadyDismissed: false,
      };
    }
    // The UPDATE missed. It could be: (a) the row is already in the
    // `dismissed` terminal state for THIS mailbox — benign replay; or
    // (b) the row doesn't exist for THIS mailbox / is not observe-mode
    // — caller cannot tell across tenants and we must collapse to 404.
    const [existing] = await this.db
      .select({
        resolution: ruleMatchLog.resolution,
        resolvedAt: ruleMatchLog.resolvedAt,
      })
      .from(ruleMatchLog)
      .where(
        and(
          eq(ruleMatchLog.mailboxAccountId, mailboxAccountId),
          eq(ruleMatchLog.id, matchId),
          eq(ruleMatchLog.modeAtMatch, 'observe'),
          eq(ruleMatchLog.resolution, 'dismissed'),
        ),
      )
      .limit(1);
    if (existing) {
      return {
        resolution: existing.resolution,
        resolvedAt: existing.resolvedAt?.toISOString() ?? new Date().toISOString(),
        alreadyDismissed: true,
      };
    }
    return null;
  }

  /**
   * U14 — approve selected pending Observe-mode suggestions (D104
   * "Approve selected"). Flips `resolution='approved'` and enqueues an
   * `autopilot-action` sweep; the action consumer executes through the
   * D226 pipeline (undo journal + activity + Gmail mutation).
   *
   * Idempotency contract (mirrors `dismissMatch`):
   *   - first approve of a pending row → counted in `approvedCount`
   *   - replayed approve of a terminal row (approved/dismissed) for
   *     THIS mailbox → counted in `alreadyResolvedCount`, 200
   *   - cross-tenant / unknown ids → silently absent from both counts
   *     (cannot probe existence across mailboxes)
   *
   * Fails 503 BEFORE any write when the action queue is down —
   * approving rows that nothing will ever execute is the stuck state
   * CLAUDE.md §10 bans (same contract as ActionsService.enqueueArchive).
   */
  async approveMatches(
    mailboxAccountId: string,
    matchIds: string[],
  ): Promise<AutopilotApproveResult> {
    this.requireActionQueue();

    const updated = await this.db
      .update(ruleMatchLog)
      .set({ resolution: 'approved', resolvedAt: sql`now()` })
      .where(
        and(
          eq(ruleMatchLog.mailboxAccountId, mailboxAccountId),
          inArray(ruleMatchLog.id, matchIds),
          eq(ruleMatchLog.modeAtMatch, 'observe'),
          eq(ruleMatchLog.resolution, 'pending'),
          SENDER_INDEXED_AT_MATCH_TIME,
        ),
      )
      .returning({ id: ruleMatchLog.id });
    const approvedCount = updated.length;

    // Benign-replay accounting: rows in THIS mailbox that are terminal
    // but were not flipped by this call (already approved or dismissed
    // before). The just-approved ids are excluded by the count diff.
    const [terminal] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(ruleMatchLog)
      .where(
        and(
          eq(ruleMatchLog.mailboxAccountId, mailboxAccountId),
          inArray(ruleMatchLog.id, matchIds),
          ne(ruleMatchLog.resolution, 'pending'),
        ),
      );
    const alreadyResolvedCount = Math.max(0, (terminal?.n ?? 0) - approvedCount);

    const executionEnqueued =
      approvedCount > 0 ? await this.enqueueActionSweep(mailboxAccountId) : false;
    return { approvedCount, alreadyResolvedCount, executionEnqueued };
  }

  /**
   * U14 — approve EVERY pending Observe-mode suggestion for one rule
   * (D104 "Approve all"). Returns `null` when the rule does not exist
   * in this mailbox (controller maps to 404). A replay approves 0 rows
   * and enqueues nothing — terminal rows are simply no longer pending.
   *
   * NOTE: deliberately does NOT flip the rule to Active — D104's
   * "Approve all and switch to Active mode" is two calls (this +
   * `PATCH mode=active`) so the FE can also offer plain "Approve
   * selected/all" without a mode change (locked safe variant: no
   * auto-promotion, the day-7 banner only PROMPTS).
   */
  async approveAllForRule(
    mailboxAccountId: string,
    ruleId: string,
  ): Promise<AutopilotApproveResult | null> {
    this.requireActionQueue();

    const [rule] = await this.db
      .select({ id: automationRules.id })
      .from(automationRules)
      .where(
        and(eq(automationRules.mailboxAccountId, mailboxAccountId), eq(automationRules.id, ruleId)),
      )
      .limit(1);
    if (!rule) return null;

    const updated = await this.db
      .update(ruleMatchLog)
      .set({ resolution: 'approved', resolvedAt: sql`now()` })
      .where(
        and(
          eq(ruleMatchLog.mailboxAccountId, mailboxAccountId),
          eq(ruleMatchLog.ruleId, ruleId),
          eq(ruleMatchLog.modeAtMatch, 'observe'),
          eq(ruleMatchLog.resolution, 'pending'),
          SENDER_INDEXED_AT_MATCH_TIME,
        ),
      )
      .returning({ id: ruleMatchLog.id });
    const approvedCount = updated.length;

    const executionEnqueued =
      approvedCount > 0 ? await this.enqueueActionSweep(mailboxAccountId) : false;
    return { approvedCount, alreadyResolvedCount: 0, executionEnqueued };
  }

  /**
   * U14 — dry-run preview (D103's "would have affected" scoped to the
   * V2 preset surface per D192). Runs the rule's matcher against the
   * SAME signal materializer the apply worker uses, so the count equals
   * what the next sweep would log. Read-only — no match rows, no
   * mutations.
   *
   * Returns `null` for a rule that doesn't exist in this mailbox OR a
   * custom rule (`presetKey=null`) — D234 keeps custom rules off the V2
   * API surface, mirroring `patchRule`'s 404 behavior.
   */
  async previewRule(
    mailboxAccountId: string,
    ruleId: string,
  ): Promise<AutopilotRulePreviewResult | null> {
    const [rule] = await this.db
      .select()
      .from(automationRules)
      .where(
        and(eq(automationRules.mailboxAccountId, mailboxAccountId), eq(automationRules.id, ruleId)),
      )
      .limit(1);
    if (!rule) return null;
    const presetKey = asPresetKey(rule.presetKey);
    if (!presetKey) return null;
    const def = AUTOPILOT_PRESETS[presetKey];

    // numeric(3,2) → number; null = use the preset default; malformed
    // strings (NaN) fall back to the default rather than silently
    // never-matching (same defense as the apply worker).
    let threshold: number | null = null;
    if (rule.confidenceThreshold !== null) {
      const parsed = Number.parseFloat(rule.confidenceThreshold);
      threshold = Number.isFinite(parsed) ? parsed : null;
    }

    const now = new Date();
    const signalRows = await materializeAutopilotSignals(this.db, mailboxAccountId, now);
    const eligible = signalRows.filter((s) => !s.signals.isProtected);

    const matched: Array<{
      senderKey: string;
      reason: string;
      inboxCount: number;
      isUnsubscribed: boolean;
    }> = [];
    let protectedWouldMatchCount = 0;
    for (const { senderKey, signals, decision, inboxCount, isUnsubscribed } of signalRows) {
      const input: PresetInput = { signals, triageDecision: decision };
      const result = def.match(input, threshold);
      if (!result.matched) continue;
      if (signals.isProtected) {
        protectedWouldMatchCount += 1;
        continue;
      }
      matched.push({ senderKey, reason: result.reason, inboxCount, isUnsubscribed });
    }

    const actionable = matched.filter((m) =>
      def.actionKind === 'unsubscribe' ? !m.isUnsubscribed : m.inboxCount > 0,
    );

    // Pre-activation volume is learned from every Observe resolution:
    // approving, dismissing, or leaving a suggestion pending must not
    // erase evidence that the rule matched. A shorter Observe window is
    // extrapolated and labelled as an early estimate; after seven days
    // the number is the observed count itself.
    const sevenDaysAgo = new Date(now.getTime() - OBSERVE_WINDOW_MS);
    const modeChangedAt = rule.modeChangedAt;
    const observationStart = modeChangedAt > sevenDaysAgo ? modeChangedAt : sevenDaysAgo;
    const [volume] = await this.db
      .select({
        observedMatches: sql<number>`count(distinct ${ruleMatchLog.id})::int`,
      })
      .from(ruleMatchLog)
      .where(
        and(
          eq(ruleMatchLog.mailboxAccountId, mailboxAccountId),
          eq(ruleMatchLog.ruleId, ruleId),
          eq(ruleMatchLog.modeAtMatch, 'observe'),
          sql`${ruleMatchLog.matchedAt} >= ${observationStart.toISOString()}::timestamptz`,
        ),
      );
    const elapsedMs = Math.max(0, now.getTime() - modeChangedAt.getTime());
    const observedDays = Math.min(7, Math.max(1, Math.ceil(elapsedMs / (24 * 60 * 60 * 1000))));
    const observedMatches = volume?.observedMatches ?? 0;
    const hasFullObservation = elapsedMs >= OBSERVE_WINDOW_MS;
    const estimatedMatches = hasFullObservation
      ? observedMatches
      : Math.ceil((observedMatches * 7) / observedDays);

    // Sample sender identities (D7 allowlist) for the first N matches.
    const sampleMatches = matched.slice(0, PREVIEW_SAMPLE_SIZE);
    const identityBy = new Map<string, { name: string | null; email: string | null }>();
    if (sampleMatches.length > 0) {
      const rows = await this.db
        .select({
          senderKey: senders.senderKey,
          displayName: senders.displayName,
          email: senders.email,
        })
        .from(senders)
        .where(
          and(
            eq(senders.mailboxAccountId, mailboxAccountId),
            inArray(
              senders.senderKey,
              sampleMatches.map((m) => m.senderKey),
            ),
          ),
        );
      for (const r of rows) {
        identityBy.set(r.senderKey, {
          name: r.displayName.length > 0 ? r.displayName : null,
          email: r.email.length > 0 ? r.email : null,
        });
      }
    }

    return {
      ruleId,
      wouldMatchCount: matched.length,
      actionableSenderCount: actionable.length,
      actionableMessageCount: actionable.reduce((total, m) => total + m.inboxCount, 0),
      protectedWouldMatchCount,
      evaluatedSenders: eligible.length,
      dailyActionCap: def.dailyActionCap,
      weeklyVolume: {
        observedMatches,
        observedDays,
        estimatedMatches,
        basis: hasFullObservation ? 'observed_7d' : 'early_estimate',
      },
      sample: sampleMatches.map((m) => ({
        senderKey: m.senderKey,
        senderName: identityBy.get(m.senderKey)?.name ?? null,
        senderEmail: identityBy.get(m.senderKey)?.email ?? null,
        reason: m.reason,
      })),
    };
  }

  /** 503 when the action queue is not wired (fail before any write). */
  private requireActionQueue(): void {
    if (!this.actionQueue) {
      throw new ServiceUnavailableException({
        code: 'QUEUE_UNAVAILABLE',
        message: 'Autopilot action queue unavailable — REDIS_URL is not set.',
      });
    }
  }

  /**
   * Enqueue one `autopilot-action` sweep for the mailbox. The sweep
   * picks up EVERY approved-unapplied match, so concurrent approvals
   * collapsing onto one job is correct. `-` separator in the jobId —
   * BullMQ rejects custom ids containing `:` (U14 smoke).
   */
  private async enqueueActionSweep(mailboxAccountId: string): Promise<boolean> {
    if (!this.actionQueue) return false;
    const triggeredAtMs = Date.now();
    await this.actionQueue.add(
      AUTOPILOT_ACTION_JOB,
      { mailboxAccountId, triggeredAtMs },
      autopilotActionJobOptions(`${mailboxAccountId}-${triggeredAtMs}`),
    );
    return true;
  }
}

const PRESET_KEY_SET = new Set<string>(AUTOPILOT_PRESET_KEYS);
function asPresetKey(k: string | null): AutopilotPresetKey | null {
  return k !== null && PRESET_KEY_SET.has(k) ? (k as AutopilotPresetKey) : null;
}

function projectRule(
  row: typeof automationRules.$inferSelect,
  observeDigest: AutopilotObserveDigest | null,
): AutopilotRule {
  // U14 — Observe-window projection (D10/D104). The window runs 7 days
  // from the LAST mode transition (`patchRule` resets `modeChangedAt`).
  // No auto-promotion happens at elapse (locked safe variant) — the FE
  // day-7 banner (U15) prompts the user off `observeWindowElapsed`.
  const inObserve = row.mode === 'observe';
  const observeWindowEndsAtMs = row.modeChangedAt.getTime() + OBSERVE_WINDOW_MS;
  return {
    id: row.id,
    presetKey: asPresetKey(row.presetKey),
    isPreset: row.isPreset,
    name: row.name,
    enabled: row.enabled,
    mode: row.mode as AutopilotRuleMode,
    modeChangedAt: row.modeChangedAt.toISOString(),
    observeWindowEndsAt: inObserve ? new Date(observeWindowEndsAtMs).toISOString() : null,
    observeWindowElapsed: inObserve && Date.now() >= observeWindowEndsAtMs,
    observePromptDismissedAt: row.observePromptDismissedAt?.toISOString() ?? null,
    // Digest is an Observe-mode surface — Active/Paused rules keep the
    // wire field null even when stale pending rows exist for them
    // ("suggestions stay pending after activation" is the D104 rule,
    // but the "would have" framing only makes sense while observing).
    // Zero-fill when in Observe with no pending rows so the FE can
    // gate on numbers, not presence.
    observeDigest: inObserve
      ? (observeDigest ?? { pendingTotal: 0, senders7d: 0, inboxMessagesNow: 0 })
      : null,
    confidenceThreshold:
      row.confidenceThreshold !== null ? Number.parseFloat(row.confidenceThreshold) : null,
    scope: row.scope as AutopilotRuleScope,
    actionKind: row.actionKind,
    actionPayload: (row.actionPayload ?? {}) as Record<string, unknown>,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    lastRunActions: row.lastRunActions,
    lastRunSenders: row.lastRunSenders,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function projectMatch(
  row: typeof ruleMatchLog.$inferSelect,
  joined: { senderName: string | null; senderEmail: string | null } = {
    senderName: null,
    senderEmail: null,
  },
): AutopilotMatch {
  return {
    id: row.id,
    ruleId: row.ruleId,
    senderKey: row.senderKey,
    // Empty display_name (the schema default) collapses to null so the FE
    // can apply its fallback uniformly (hash) rather than rendering an
    // empty string between the rule chip and the verb.
    senderName:
      joined.senderName != null && joined.senderName.length > 0 ? joined.senderName : null,
    senderEmail:
      joined.senderEmail != null && joined.senderEmail.length > 0 ? joined.senderEmail : null,
    matchedAt: row.matchedAt.toISOString(),
    modeAtMatch: row.modeAtMatch,
    confidence: Number.parseFloat(row.confidence),
    reason: row.reason,
    resolution: row.resolution,
    intentApplied: row.intentApplied,
    intentToken: row.intentToken,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  };
}
