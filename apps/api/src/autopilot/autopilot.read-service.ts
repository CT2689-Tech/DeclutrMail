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
  automationRules,
  mailMessages,
  ruleMatchLog,
  senderPolicies,
  senders,
  triageDecisions,
  undoJournal,
} from '@declutrmail/db';
import {
  AUTOPILOT_ACTION_JOB,
  AUTOPILOT_PRESETS,
  autopilotActionJobOptions,
  materializeAutopilotSignals,
  type AutopilotActionJobData,
  type PresetInput,
} from '@declutrmail/workers';
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

/** D246 repeated-decision evidence and dismissal windows. */
const PATTERN_EVIDENCE_WINDOW_DAYS = 30;
const PATTERN_EVIDENCE_MIN_SENDERS = 3;
const PATTERN_PRESET_KEYS = ['auto_archive_low_engagement', 'auto_unsubscribe_noisy'] as const;

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
          sql`${triageDecisions.confidence} > ${automationRules.confidenceThreshold}`,
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
   *   - `messages7d`   — INBOX messages from those senders (LEFT JOIN
   *     mail_messages, same resolution the action sweep uses) — the
   *     "would have archived N emails" number.
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
        pendingTotal: sql<number>`count(distinct ${ruleMatchLog.id}) filter (where ${pending})::int`,
        senders7d: sql<number>`count(distinct ${ruleMatchLog.senderKey}) filter (where ${recent})::int`,
        messages7d: sql<number>`count(distinct ${mailMessages.id}) filter (where ${recent})::int`,
      })
      .from(ruleMatchLog)
      .leftJoin(
        mailMessages,
        and(
          eq(mailMessages.mailboxAccountId, ruleMatchLog.mailboxAccountId),
          eq(mailMessages.senderKey, ruleMatchLog.senderKey),
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
        { pendingTotal: r.pendingTotal, senders7d: r.senders7d, messages7d: r.messages7d },
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
      ? (observeDigest ?? { pendingTotal: 0, senders7d: 0, messages7d: 0 })
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
