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
 * Confidence bands (D21, Phase C re-weighted 2026-07-02 per D29 triage-
 * quality fix — see the Phase C block comment):
 *   Phase A : 0.80..1.00  (depending on which rule fired)
 *   Phase B : 0.70        (rule 7 — "too new to judge")
 *   Phase C : 0.55..0.95  (clamp; computed from winner strength + margin)
 *   Phase C fallback (both < 0.50) : 0.60  (low confidence — defer to user)
 *   Phase C gated (no unsubscribe stream, archive < 0.50) : 0.60
 *
 * D227: `verdict` values are the closed K/A/U/L union — `'later'` (not
 * `'screen'`) for the low-confidence cases. Matches the rest of the
 * codebase's enum precedent.
 *
 * D222: NO category prediction here. The cascade reads `gmailCategory`
 * but only Gmail's own CATEGORY_* label assignment — DeclutrMail never
 * predicts which category a sender belongs to. The two 2026-07-02
 * signals are rule-matched FACTS, not predicted categories:
 *   - `unsubscribeChannel` is read off the sender's own
 *     `List-Unsubscribe` headers (RFC 2369 / RFC 8058) — the sender
 *     declares it; we never infer it.
 *   - `isGovDomain` is a deterministic public-suffix check on the
 *     sender's domain (.gov / .mil ± country code). It is computed at
 *     scoring time, never persisted, and never used to protect or
 *     route — it only CAPS how confident the engine claims to be about
 *     an Unsubscribe recommendation (a wrong unsubscribe from an
 *     official source is high-regret).
 */

/** Why the cascade returned the verdict — feeds the audit copy + template. */
export type CascadeRuleId =
  // Phase A — protection / engagement rules (always Keep).
  | 'protect_user_defined'
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
  | 'score_inconclusive'
  // Phase C — unsubscribe gated, archive didn't clear the bar either.
  // Split per gate leg so the audit copy says the honest, specific
  // thing instead of "signals are mixed":
  //   - `score_no_unsub_channel` — the sender declares no
  //     List-Unsubscribe channel at all; there is nothing to act on.
  //   - `score_quiet_stream` — a channel exists but the stream is
  //     below MIN_UNSUB_STREAM_VOLUME; too quiet to be worth cutting.
  | 'score_no_unsub_channel'
  | 'score_quiet_stream';

/** Closed union of cascade phases — used by the template + telemetry. */
export type CascadePhase = 'A' | 'B' | 'C';

/**
 * The sender's own declared unsubscribe channel, read off its
 * `List-Unsubscribe` headers (already stored per-message under the D7
 * allowlist; mirrors `senders.unsubscribe_method`'s derivation):
 *   - `one_click` — RFC 8058 One-Click seen on ≥ 1 message.
 *   - `mailto`    — a List-Unsubscribe URL/mailto exists, but no
 *                   one-click capability (manual at launch per D230).
 *   - `none`      — no List-Unsubscribe header ever seen.
 *
 * A closed union (not two booleans) so "one-click without a header"
 * is unrepresentable.
 */
export type UnsubscribeChannel = 'one_click' | 'mailto' | 'none';

/**
 * Deterministic government/military public-suffix check (D29 confidence
 * damping). Matches domains ENDING in `.gov` or `.mil`, optionally with
 * a two-letter country code after (`.gov.in`, `.gov.uk`, `.mil.co`).
 * Bare `gov.uk`-style domains match too.
 *
 * D222 note: this is a rule-matched FACT about the domain string —
 * transparent, testable, computed at scoring time, never persisted,
 * never used to protect/route. Not a predicted category. (D22 removed
 * domain-pattern AUTO-PROTECTION; this caps recommendation confidence
 * instead, which is the opposite of routing — it makes the engine
 * claim LESS, never act more.)
 *
 * Known non-matches (accepted): `.gouv.fr`, `.gc.ca` and other
 * non-gov/mil official suffixes. Extend the pattern if they show up in
 * real queues — do not generalize to a category list.
 */
const GOV_DOMAIN_RE = /(^|\.)(gov|mil)(\.[a-z]{2})?$/i;
export function isGovernmentDomain(domain: string): boolean {
  return GOV_DOMAIN_RE.test(domain.trim());
}

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
  protectionReason?: 'user_defined' | 'engagement_based';
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
   * The sender's declared unsubscribe channel (see `UnsubscribeChannel`).
   * Replaces the pre-D29-fix `hasUnsubscribeHeader` boolean: Phase C
   * needs to know HOW unsubscribable a sender is, not just whether a
   * header ever appeared.
   */
  unsubscribeChannel: UnsubscribeChannel;
  /**
   * Deterministic `.gov`/`.mil` public-suffix fact about the sender's
   * domain — see `isGovernmentDomain`. Caps Unsubscribe confidence;
   * never protects, routes, or persists anything (D222-safe).
   */
  isGovDomain: boolean;
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

/**
 * Minimum 90-day average monthly volume for a sender to count as an
 * ACTIVE MAILING STREAM. Below this there is nothing worth
 * unsubscribing from — a quarterly statement or an 8-lifetime-message
 * agency sender is not a stream, however unread it is.
 */
export const MIN_UNSUB_STREAM_VOLUME = 2;

/**
 * Ceiling for Unsubscribe confidence on `.gov`/`.mil` senders. A wrong
 * "Unsubscribe from the DMV · 95%" is an activation-killing
 * recommendation; official-source unsubscribes stay below the
 * high-confidence band no matter how strong the other signals are.
 */
export const GOV_UNSUB_CONFIDENCE_CAP = 0.75;

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
  // Rule 1 — protection policy. The cascade splits manual protection from
  // engagement-derived protection so the audit copy stays factual.
  if (s.isProtected) {
    const reason = s.protectionReason ?? 'user_defined';
    return {
      verdict: 'keep',
      confidence: 1.0,
      phase: 'A',
      ruleId: reason === 'engagement_based' ? 'protect_engagement_based' : 'protect_user_defined',
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
  // Re-weighted 2026-07-02 (D29 triage-quality fix; supersedes the frozen
  // D21 §scoring weights — plan patch pending, see PR). The original
  // weights let INACTIVITY alone (read_rate 0 + stale) reach 0.80 and,
  // with `winner/(winner+loser)` degenerating to 1.0 when the loser was
  // 0, every quiet sender surfaced as "Unsubscribe · 95%" — including
  // no-reply government and transactional senders with NO unsubscribe
  // channel at all. Unsubscribe now requires POSITIVE unsubscribe-ability
  // + stream behavior; disengagement only corroborates.
  //
  // Each `if` is INDEPENDENT — MISTAKES.md 2026-05-20 entry: do not
  // collapse independent buckets into if/else-if.
  const hasUnsubChannel = s.unsubscribeChannel !== 'none';

  let archive = 0;
  if (s.monthlyVolume >= 30) archive += 0.3;
  if (s.monthlyVolume >= 60) archive += 0.2;
  if (s.userManuallyArchivedCount >= 3) archive += 0.3;
  if (hasUnsubChannel) archive += 0.15;

  // Unsubscribe HARD GATE: a sender is only unsubscribable when it
  // declares a channel (List-Unsubscribe) AND behaves like an active
  // stream (≥ MIN_UNSUB_STREAM_VOLUME msgs/mo over 90d). A sender that
  // fails the gate scores 0 — there is no stream to cut, so silence
  // (read_rate 0, stale last_seen) is NOT evidence for Unsubscribe.
  let unsubscribe = 0;
  if (hasUnsubChannel && s.monthlyVolume >= MIN_UNSUB_STREAM_VOLUME) {
    // Positive unsubscribe-ability — the channel itself, graded by
    // strength (one-click is automatic; mailto is manual per D230).
    if (s.unsubscribeChannel === 'one_click') unsubscribe += 0.35;
    if (s.unsubscribeChannel === 'mailto') unsubscribe += 0.2;
    // Positive stream behavior — volume, graded.
    if (s.monthlyVolume >= 8) unsubscribe += 0.15;
    if (s.monthlyVolume >= 30) unsubscribe += 0.15;
    // Disengagement CORROBORATES (max +0.25) but can never carry the
    // verdict alone — the pre-fix 0.40/0.30 read-rate weights were the
    // over-recommendation bug.
    if (s.readRate90d < 0.2) unsubscribe += 0.15;
    if (s.readRate90d < 0.05) unsubscribe += 0.1;
    // Gmail's OWN category label (not predicted — D222).
    if (
      s.gmailCategory === 'promotions' ||
      s.gmailCategory === 'forums' ||
      s.gmailCategory === 'social'
    ) {
      unsubscribe += 0.1;
    }
    // Behavior-change spike.
    if (s.spikeRatio >= 3) unsubscribe += 0.1;
  }
  // (Removed from D21 §unsubscribe_score: `last_seen_days >= 30 → +0.10`.
  // Staleness means the stream already went quiet — it is not a reason
  // to unsubscribe, and it was the core of the inactivity bug.)

  const scores = { archive: round2(archive), unsubscribe: round2(unsubscribe) };

  // Gate failed and archive didn't clear the bar either → Later, with
  // honest audit copy per gate leg — not "signals are mixed". This is
  // where the DMV-style no-reply / quiet transactional senders land now.
  if (!(hasUnsubChannel && s.monthlyVolume >= MIN_UNSUB_STREAM_VOLUME) && archive < 0.5) {
    return {
      verdict: 'later',
      confidence: 0.6,
      phase: 'C',
      // No channel is the stronger fact — report it even when the
      // stream is also quiet.
      ruleId: hasUnsubChannel ? 'score_quiet_stream' : 'score_no_unsub_channel',
      facts,
      scores,
    };
  }

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

  // Confidence = winner STRENGTH + MARGIN over the loser, distributed
  // inside the locked [0.55, 0.95] band. The pre-fix `winner/(winner+
  // loser)` ratio degenerated to 1.0 → clamp 0.95 whenever the loser
  // was 0, which pinned essentially every Phase C verdict at 95%. The
  // additive form spreads honestly: a maxed-out one-click newsletter
  // lands ~0.90; a mailto-only mid-volume case ~0.75; nothing in Phase C
  // reaches 0.95 anymore (the loser always keeps ≥ 0.15 via the shared
  // channel weight whenever unsubscribe is in play).
  const strength = clamp(winner, 0, 1);
  const margin = clamp(winner - loser, 0, 1);
  let confidence = round2(clamp(0.5 + 0.35 * strength + 0.1 * margin, 0.55, 0.95));

  // Government/military senders: never claim high confidence on
  // Unsubscribe, regardless of signals — a wrong unsubscribe from an
  // official source (DMV, IRS, tax portals) is high-regret and reads
  // as unserious. Cap, don't reroute (D222: no protection, no category).
  if (!archiveWins && s.isGovDomain) {
    confidence = Math.min(confidence, GOV_UNSUB_CONFIDENCE_CAP);
  }

  return {
    verdict: archiveWins ? 'archive' : 'unsubscribe',
    confidence,
    phase: 'C',
    ruleId: archiveWins ? 'score_archive' : 'score_unsubscribe',
    facts,
    scores,
  };
}
