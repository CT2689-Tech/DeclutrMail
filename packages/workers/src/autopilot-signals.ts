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

  // LIFETIME timeseries — every month, summed per sender.
  //
  // Not a 90-day window, deliberately. The dormancy presets that read
  // this require `lastSeenDaysAgo > 90`, so a 90-day window is empty for
  // every sender they can reach — the rate was structurally unmeasurable
  // for exactly the senders that needed it (F009). Summing the sender's
  // own months is what makes the test able to fail again.
  //
  // `read_count` here is already decontaminated: `reconcileSenderTimeseries`
  // excludes sweeper-marked mail from the numerator (mig 0064). A mailbox
  // that has not re-synced since 0064 still carries the old counters for
  // one sync cycle — the rate is then too HIGH, which under-matches, and
  // under-matching a preset whose action is an unsubscribe is the safe
  // direction for a transient.
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
  // access.
  //
  // The INBOX predicate must match the action worker's
  // `resolveSenderInboxIds`, so "actionable at match time" and
  // "resolvable at act time" cannot drift. It did drift: that resolver
  // goes through `senderInboxActionWhere`, which filters
  // `is_outbound = false`, and this copy did not — so mail the USER sent
  // counted toward a rule's actionable set and then could not be acted
  // on. 446 messages across one sender on the mailbox this was found on.
  // The comment claimed the invariant the code broke, which is why it is
  // stated as a requirement here rather than as a fact.
  const totalRows = await db
    .select({
      senderKey: mailMessages.senderKey,
      total: sql<number>`count(*)::int`,
      inbox: sql<number>`count(*) FILTER (WHERE ${mailMessages.isOutbound} = false AND 'INBOX' = ANY(${mailMessages.labelIds}))::int`,
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
      // `null`, not 0 — see `PresetSignals.readRateLifetime`. A `0` here
      // is what made the dormancy presets' read-rate predicate a
      // tautology; "we hold no mail from them" is not "never read".
      readRateLifetime: ts.volume > 0 ? ts.reads / ts.volume : null,
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
