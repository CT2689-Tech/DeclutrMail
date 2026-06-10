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
// What this service does NOT do (deferred to the action-consumer PR):
//   - Emit Gmail mutations on `approve`. The approve flow requires
//     creating an `undo_journal` row and emitting an outbox event to
//     the action consumer, which is its own PR. Today the dismiss
//     endpoint exists; approve does NOT.
//
// PRIVACY (D7, D228): every column read here is metadata. The match
// log's `sender_key` is the sha256 hex digest, never the raw email.
// The rule's `conditions` + `action_payload` jsonb reference engine
// signals, never message body content.

import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, ne, sql } from 'drizzle-orm';

import {
  AUTOPILOT_PRESET_KEYS,
  type AutopilotPresetKey,
  type AutopilotRuleMode,
  type AutopilotRuleScope,
  automationRules,
  ruleMatchLog,
  senders,
} from '@declutrmail/db';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import type {
  AutopilotMatch,
  AutopilotMatchDismissResult,
  AutopilotPauseAllResult,
  AutopilotRule,
  AutopilotRulePatch,
} from './autopilot.types.js';

@Injectable()
export class AutopilotReadService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

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
    return rows.map((r) => projectRule(r));
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
    return row ? projectRule(row) : null;
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
      patch.scope === undefined
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
      // Reset the Observe-window timer on any mode transition.
      set.modeChangedAt = sql`now()`;
    }
    if (patch.confidenceThreshold !== undefined) {
      set.confidenceThreshold =
        patch.confidenceThreshold === null ? null : patch.confidenceThreshold.toFixed(2);
    }
    if (patch.scope !== undefined) set.scope = patch.scope;

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
    return updated ? projectRule(updated) : null;
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
    const PAGE_SIZE = 50;
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
      .set({ resolution: 'dismissed', resolvedAt: sql`now()` })
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
}

const PRESET_KEY_SET = new Set<string>(AUTOPILOT_PRESET_KEYS);
function asPresetKey(k: string | null): AutopilotPresetKey | null {
  return k !== null && PRESET_KEY_SET.has(k) ? (k as AutopilotPresetKey) : null;
}

function projectRule(row: typeof automationRules.$inferSelect): AutopilotRule {
  return {
    id: row.id,
    presetKey: asPresetKey(row.presetKey),
    isPreset: row.isPreset,
    name: row.name,
    enabled: row.enabled,
    mode: row.mode as AutopilotRuleMode,
    modeChangedAt: row.modeChangedAt.toISOString(),
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
