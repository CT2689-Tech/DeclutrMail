import type { TriageVerdict } from '@declutrmail/db';

/**
 * The deterministic decision engine cascade (D20, D21, D22).
 *
 * Pure function — no DB, no LLM, no clock. The worker loads `SenderSignals`,
 * calls `runCascade`, and uses the returned `CascadeResult` to upsert
 * `triage_decisions`. Pure → trivially testable; the cascade tests cover
 * every D21 branch without spinning up a DB.
 *
 * D21 phases run IN ORDER. The first matching rule wins; later rules are
 * not consulted. Order matters:
 *
 *   Phase A (cascade)   — rules 1..6. Always Keep, exit on first match.
 *   Phase B (low signal) — rule 7. Always Later, exit.
 *   Phase C (scoring)   — Archive vs Unsubscribe; argmax wins.
 *
 * Confidence bands per D21 (locked):
 *   Phase A : 0.80..1.00  (depending on which rule fired)
 *   Phase B : 0.70        (rule 7 — "too new to judge")
 *   Phase C : 0.55..0.95  (clamp; computed from winner / (winner + loser))
 *   Phase C fallback (both < 0.50) : 0.60  (low confidence — defer to user)
 *
 * D227: `verdict` values are the closed K/A/U/L union — `'later'` (not
 * `'screen'`) for the low-confidence cases. Matches the rest of the
 * codebase's enum precedent.
 *
 * D222: NO category prediction here. The cascade reads `gmailCategory`
 * but only Gmail's own CATEGORY_* label assignment — DeclutrMail never
 * predicts which category a sender belongs to. The score weights from
 * D21 §unsubscribe_score use the user-observed category, not an inferred
 * one.
 */

/** Why the cascade returned the verdict — feeds the audit copy + template. */
export type CascadeRuleId =
  // Phase A — protection / engagement rules (always Keep).
  | 'protect_user_defined'
  | 'protect_vip'
  | 'protect_engagement_based'
  | 'replied_at_least_once'
  | 'gmail_primary'
  | 'starred_recently'
  | 'high_read_rate'
  | 'long_relationship_engaged'
  // Phase B — insufficient signal (always Later).
  | 'insufficient_signal'
  // Phase C — score winner / fallback.
  | 'score_archive'
  | 'score_unsubscribe'
  | 'score_inconclusive';

/** Closed union of cascade phases — used by the template + telemetry. */
export type CascadePhase = 'A' | 'B' | 'C';

/**
 * Signals the cascade needs. The worker materializes this from
 * `senders`, `sender_timeseries`, `sender_policies`, and metadata-only
 * aggregates over `mail_messages`. All counts are integers; rates are
 * `[0, 1]` floats; ages are unsigned integer days/months.
 *
 * D7 / D228: every field below is metadata. No body, no MIME, no
 * non-allowlisted header is ever read to compute these.
 */
export interface SenderSignals {
  /** The user has set `sender_policies.is_protected = true`. */
  isProtected: boolean;
  /**
   * Provenance of `isProtected` — drives the cascade audit copy. Undefined
   * when `isProtected = false`.
   */
  protectionReason?: 'user_defined' | 'engagement_based' | 'vip';
  /** The user has set `sender_policies.is_vip = true`. */
  isVip: boolean;
  /** D21 rule 2 — user has replied to this sender at least once. */
  hasReplied: boolean;
  /**
   * Gmail's own `CATEGORY_PERSONAL` (mapped to `'primary'` in our enum).
   * D222: this is GMAIL's classification, not DeclutrMail's prediction.
   */
  gmailCategory: 'primary' | 'promotions' | 'social' | 'updates' | 'forums';
  /** D21 rule 4 — user has starred ≥ 1 message in the past year. */
  starredInLastYear: boolean;
  /** D21 rule 5 — `read_rate` over the last 90 days, `[0, 1]`. */
  readRate90d: number;
  /** Months since `first_seen_at`. D21 rule 6 uses ≥ 60. */
  firstSeenMonthsAgo: number;
  /** Days since `first_seen_at`. D21 rule 7 (Phase B) uses < 7. */
  firstSeenDaysAgo: number;
  /** Days since `last_seen_at`. D21 §unsubscribe_score: ≥ 30 = stale. */
  lastSeenDaysAgo: number;
  /** Total messages ever seen from this sender. D21 rule 7 uses < 3. */
  totalMessages: number;
  /** Average monthly messages over the last 90 days. */
  monthlyVolume: number;
  /**
   * `monthly_volume / baseline_30d_avg` — D21 §unsubscribe_score: ≥ 3 =
   * "behavior change" spike.
   */
  spikeRatio: number;
  /**
   * Whether ANY of this sender's recent messages had a `List-Unsubscribe`
   * header. D21 score weights use it on both sides (corroborating).
   */
  hasUnsubscribeHeader: boolean;
  /** Times the user has manually archived a message from this sender. */
  userManuallyArchivedCount: number;
}

/** What the cascade returned — verdict + provenance + confidence band. */
export interface CascadeResult {
  verdict: TriageVerdict;
  confidence: number;
  phase: CascadePhase;
  ruleId: CascadeRuleId;
  /**
   * Numeric facts the explanation template references — keeps the template
   * pure-string and the cascade as the single source of truth for the
   * numbers that show up in the UI.
   */
  facts: {
    monthlyVolume: number;
    readRatePct: number;
  };
  /** Component scores when Phase C ran; undefined for Phase A/B. */
  scores?: {
    archive: number;
    unsubscribe: number;
  };
}

/** Clamp `x` into `[lo, hi]`. */
function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** Round to 2 dp to match the `numeric(3, 2)` storage precision. */
function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/**
 * Run the D21 cascade. Pure — no side effects, no clock.
 *
 * Phase A rules run TOP-DOWN and short-circuit on first match (the D21
 * cascade is explicit about this — "always Keep, exit"). The rule IDs
 * encode the audit-trail provenance directly.
 */
export function runCascade(s: SenderSignals): CascadeResult {
  const facts = {
    monthlyVolume: s.monthlyVolume,
    readRatePct: Math.round(s.readRate90d * 100),
  };

  // ─── Phase A — protection / engagement (Keep, exit) ────────────────────
  // Rule 1 — user-set protect policy. The cascade splits by reason so the
  // audit copy can say which kind of protect fired ("you marked them VIP"
  // vs "we kept them because you reply to them").
  if (s.isProtected) {
    const reason = s.protectionReason ?? 'user_defined';
    return {
      verdict: 'keep',
      confidence: 1.0,
      phase: 'A',
      ruleId:
        reason === 'vip'
          ? 'protect_vip'
          : reason === 'engagement_based'
            ? 'protect_engagement_based'
            : 'protect_user_defined',
      facts,
    };
  }

  // Rule 2 — user replied. Strongest positive engagement.
  if (s.hasReplied) {
    return {
      verdict: 'keep',
      confidence: 0.98,
      phase: 'A',
      ruleId: 'replied_at_least_once',
      facts,
    };
  }

  // Rule 3 — Gmail's own Primary category.
  if (s.gmailCategory === 'primary') {
    return {
      verdict: 'keep',
      confidence: 0.95,
      phase: 'A',
      ruleId: 'gmail_primary',
      facts,
    };
  }

  // Rule 4 — starred in last year.
  if (s.starredInLastYear) {
    return {
      verdict: 'keep',
      confidence: 0.92,
      phase: 'A',
      ruleId: 'starred_recently',
      facts,
    };
  }

  // Rule 5 — read_rate ≥ 50% over 90 days. "Engaged reader."
  if (s.readRate90d >= 0.5) {
    return {
      verdict: 'keep',
      confidence: 0.85,
      phase: 'A',
      ruleId: 'high_read_rate',
      facts,
    };
  }

  // Rule 6 — long relationship still engaged.
  if (s.firstSeenMonthsAgo >= 60 && s.readRate90d >= 0.3) {
    return {
      verdict: 'keep',
      confidence: 0.8,
      phase: 'A',
      ruleId: 'long_relationship_engaged',
      facts,
    };
  }

  // ─── Phase B — insufficient signal (Later, exit) ───────────────────────
  // Rule 7 — too new to judge. D23 default for new senders.
  if (s.totalMessages < 3 || s.firstSeenDaysAgo < 7) {
    return {
      verdict: 'later',
      confidence: 0.7,
      phase: 'B',
      ruleId: 'insufficient_signal',
      facts,
    };
  }

  // ─── Phase C — scoring (Archive vs Unsubscribe; argmax wins) ───────────
  // Weights frozen from D21 §scoring. Each `if` is INDEPENDENT — MISTAKES.md
  // 2026-05-20 entry: do not collapse independent buckets into if/else-if.
  let archive = 0;
  if (s.monthlyVolume >= 30) archive += 0.3;
  if (s.monthlyVolume >= 60) archive += 0.2;
  if (s.userManuallyArchivedCount >= 3) archive += 0.3;
  if (s.hasUnsubscribeHeader) archive += 0.15;

  let unsubscribe = 0;
  if (s.readRate90d < 0.05) unsubscribe += 0.4;
  if (s.readRate90d < 0.2) unsubscribe += 0.3;
  if (s.spikeRatio >= 3) unsubscribe += 0.3;
  if (s.hasUnsubscribeHeader) unsubscribe += 0.2;
  if (
    s.gmailCategory === 'promotions' ||
    s.gmailCategory === 'forums' ||
    s.gmailCategory === 'social'
  ) {
    unsubscribe += 0.2;
  }
  if (s.monthlyVolume >= 60) unsubscribe += 0.2;
  if (s.lastSeenDaysAgo >= 30) unsubscribe += 0.1;

  const scores = { archive: round2(archive), unsubscribe: round2(unsubscribe) };

  // Both below 0.50 → low-confidence Phase C fallback → Later.
  if (archive < 0.5 && unsubscribe < 0.5) {
    return {
      verdict: 'later',
      confidence: 0.6,
      phase: 'C',
      ruleId: 'score_inconclusive',
      facts,
      scores,
    };
  }

  // D21: argmax with a deterministic tie-break to Archive — Archive is
  // less destructive than Unsubscribe (Archive removes INBOX; Unsubscribe
  // stops a stream). On a tie the safer choice wins. Locked tie-break.
  const archiveWins = archive >= unsubscribe;
  const winner = archiveWins ? archive : unsubscribe;
  const loser = archiveWins ? unsubscribe : archive;
  const sum = winner + loser;
  // `sum === 0` cannot happen here (we'd be in the inconclusive branch),
  // but the divide-by-zero guard keeps the type sound.
  const rawConfidence = sum > 0 ? winner / sum : 0.55;
  const confidence = round2(clamp(rawConfidence, 0.55, 0.95));

  return {
    verdict: archiveWins ? 'archive' : 'unsubscribe',
    confidence,
    phase: 'C',
    ruleId: archiveWins ? 'score_archive' : 'score_unsubscribe',
    facts,
    scores,
  };
}
