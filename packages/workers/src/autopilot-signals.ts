import { and, eq, inArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import {
  mailMessages,
  type schema,
  senderPolicies,
  senders,
  senderTimeseries,
  triageDecisions,
  type TriageVerdict,
} from '@declutrmail/db';

import type { PresetSignals } from './autopilot-presets.js';

type WorkerDb = PostgresJsDatabase<typeof schema>;

/** 90 days in milliseconds — read-rate aggregate window. */
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * One sender's materialized preset-signal row: the minimal
 * `PresetSignals` plus the engine's current triage decision.
 */
export interface AutopilotSignalRow {
  senderKey: string;
  signals: PresetSignals;
  decision: { verdict: TriageVerdict; confidence: number } | null;
  /**
   * Actionability facts for ACTIVE-mode matching (not part of
   * `PresetSignals` — preset matchers and the dry-run preview answer
   * "does the rule match", these answer "would acting do anything").
   * The apply worker skips active-mode inserts for non-actionable
   * matches; without that gate every delta-triggered sweep (D100)
   * re-executes the full match set as 0-affected actions — unbounded
   * `rule_match_log`/`action_jobs`/`activity_log` growth plus an
   * Activity feed full of "archived 0" entries.
   */
  inboxCount: number;
  isUnsubscribed: boolean;
}

/**
 * Materialize the minimal `PresetSignals` for every sender in a
 * mailbox, plus the engine's current triage decision (D99–D101).
 *
 * Extracted from `AutopilotApplyWorker`'s private method (U14) so the
 * dry-run preview endpoint (`POST /autopilot/rules/:id/preview`) and
 * the apply worker evaluate IDENTICAL signals — a preview that
 * materialized its own variant would drift from what the sweep
 * actually matches.
 *
 * Three small follow-up queries (`sender_policies`, `sender_timeseries`,
 * `mail_messages count(*)`) keep this readable — not yet on the hot
 * path; unifying them is straightforward later if profiling shows cost.
 *
 * D7 / D228: every column read is metadata. `mail_messages.count(*)`
 * does not touch body / snippet / non-allowlisted headers.
 */
export async function materializeAutopilotSignals(
  db: WorkerDb,
  mailboxAccountId: string,
  now: Date,
): Promise<AutopilotSignalRow[]> {
  const senderRows = await db
    .select({
      senderKey: senders.senderKey,
      firstSeenAt: senders.firstSeenAt,
      lastSeenAt: senders.lastSeenAt,
    })
    .from(senders)
    .where(eq(senders.mailboxAccountId, mailboxAccountId));
  if (senderRows.length === 0) return [];

  const keys = senderRows.map((r) => r.senderKey);

  const policyRows = await db
    .select({
      senderKey: senderPolicies.senderKey,
      isProtected: senderPolicies.isProtected,
      policyType: senderPolicies.policyType,
    })
    .from(senderPolicies)
    .where(
      and(
        eq(senderPolicies.mailboxAccountId, mailboxAccountId),
        inArray(senderPolicies.senderKey, keys),
      ),
    );
  const isProtectedBy = new Map(policyRows.map((r) => [r.senderKey, r.isProtected]));
  // Same projection the action worker's already-unsubscribed guard
  // reads (`policy_type='unsubscribe'`) — matching at the source keeps
  // the apply pass from re-inserting matches that guard would no-op.
  const isUnsubscribedBy = new Map(
    policyRows.map((r) => [r.senderKey, r.policyType === 'unsubscribe']),
  );

  const decisionRows = await db
    .select({
      senderKey: triageDecisions.senderKey,
      verdict: triageDecisions.verdict,
      confidence: triageDecisions.confidence,
    })
    .from(triageDecisions)
    .where(
      and(
        eq(triageDecisions.mailboxAccountId, mailboxAccountId),
        inArray(triageDecisions.senderKey, keys),
      ),
    );
  // Skip decision rows whose `confidence` (numeric(3,2) → string)
  // doesn't parse to a finite number. NaN would propagate into the
  // matcher's `confidence <= threshold` comparison and silently
  // mis-evaluate; treating it as "no decision" is the safe default.
  const decisionBy = new Map<string, { verdict: TriageVerdict; confidence: number }>();
  for (const r of decisionRows) {
    const c = Number.parseFloat(r.confidence);
    if (!Number.isFinite(c)) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          kind: 'autopilot.malformed_decision_confidence',
          senderKey: r.senderKey,
          rawConfidence: r.confidence,
        }),
      );
      continue;
    }
    decisionBy.set(r.senderKey, { verdict: r.verdict, confidence: c });
  }

  // 90-day timeseries — sum volume + reads per sender.
  const ninetyDaysAgo = new Date(now.getTime() - NINETY_DAYS_MS);
  const yearMonth90 = ninetyDaysAgo.toISOString().slice(0, 10);
  const tsRows = await db
    .select({
      senderKey: senderTimeseries.senderKey,
      volume: senderTimeseries.volume,
      readCount: senderTimeseries.readCount,
    })
    .from(senderTimeseries)
    .where(
      and(
        eq(senderTimeseries.mailboxAccountId, mailboxAccountId),
        inArray(senderTimeseries.senderKey, keys),
        sql`${senderTimeseries.yearMonth} >= ${yearMonth90}`,
      ),
    );
  const tsAgg = new Map<string, { volume: number; reads: number }>();
  for (const r of tsRows) {
    const prev = tsAgg.get(r.senderKey) ?? { volume: 0, reads: 0 };
    tsAgg.set(r.senderKey, {
      volume: prev.volume + r.volume,
      reads: prev.reads + r.readCount,
    });
  }

  // Total + INBOX-labeled messages per sender — count(*) only; no body
  // access. The INBOX predicate mirrors the action worker's
  // `resolveSenderInboxIds` exactly, so "actionable at match time" and
  // "resolvable at act time" cannot drift.
  const totalRows = await db
    .select({
      senderKey: mailMessages.senderKey,
      total: sql<number>`count(*)::int`,
      inbox: sql<number>`count(*) FILTER (WHERE 'INBOX' = ANY(${mailMessages.labelIds}))::int`,
    })
    .from(mailMessages)
    .where(
      and(
        eq(mailMessages.mailboxAccountId, mailboxAccountId),
        inArray(mailMessages.senderKey, keys),
      ),
    )
    .groupBy(mailMessages.senderKey);
  const totalBy = new Map(
    totalRows
      .filter((r): r is { senderKey: string; total: number; inbox: number } => r.senderKey !== null)
      .map((r) => [r.senderKey, { total: r.total, inbox: r.inbox }]),
  );

  const dayMs = 24 * 60 * 60 * 1000;
  return senderRows.map((s) => {
    const ts = tsAgg.get(s.senderKey) ?? { volume: 0, reads: 0 };
    const counts = totalBy.get(s.senderKey) ?? { total: 0, inbox: 0 };
    const signals: PresetSignals = {
      isProtected: Boolean(isProtectedBy.get(s.senderKey) ?? false),
      firstSeenDaysAgo: Math.floor((now.getTime() - s.firstSeenAt.getTime()) / dayMs),
      lastSeenDaysAgo: Math.floor((now.getTime() - s.lastSeenAt.getTime()) / dayMs),
      totalMessages: counts.total,
      readRate90d: ts.volume > 0 ? ts.reads / ts.volume : 0,
    };
    return {
      senderKey: s.senderKey,
      signals,
      decision: decisionBy.get(s.senderKey) ?? null,
      inboxCount: counts.inbox,
      isUnsubscribed: isUnsubscribedBy.get(s.senderKey) ?? false,
    };
  });
}
