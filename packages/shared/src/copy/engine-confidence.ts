// @declutrmail/shared/copy — how sure the engine is, in words.
//
// `triage_decisions.confidence` is not a probability. `score-cascade.ts`
// builds it by adding fixed weights (0.35 for a one-click channel, 0.15
// for volume, 0.10 for a Gmail category …) and clamping the total into a
// narrow band, so the set of values it can actually reach is small, and
// the top of it saturates. Two facts follow, and both were shipping as
// bugs until 2026-08-20.
//
// FIRST: the scales are not comparable across verdicts, so no single
// cross-verdict threshold can be right for all four. D31's flat
// "highlight when confidence > 0.85" was sized for Unsubscribe. Archive
// can only reach [0.73, 0.88], and everything above 0.85 there requires
// the user to have already archived that sender 3+ times by hand (the
// `+0.30 userManuallyArchivedCount` term) — enumerate the weight set
// with no manual history and Archive tops out at 0.74. So Archive was a
// verdict that could never be recommended. The queue sorts Archive
// FIRST (verdict priority in `triage.read-service.ts`), which put the
// one unrecommendable verdict in the hero slot on every load: the most
// detailed card on the screen was also the only one with no band and no
// Recommended hint (founder screenshot, 2026-08-20).
//
// SECOND: a rounded `NN%` claims a precision the cascade does not have.
// Because the queue also sorts by confidence DESC, the head of a real
// queue printed the same "91%" on four consecutive senders — honest,
// and it read as fabricated. Three words carry every distinction those
// two digits actually supported.

/**
 * The four verdicts the engine can emit — mirrors the `triage_verdict`
 * DB enum. Delete is user-chosen and is never a recommendation.
 */
export type EngineVerdict = 'keep' | 'archive' | 'unsubscribe' | 'later';

/**
 * Confidence floor per verdict, above which the engine's read is
 * presented as a RECOMMENDATION — D31's toolbar highlight, the verdict
 * pill's band, and the row's `Recommended` hint all read this one value.
 *
 * Archive's floor sits just under the bottom of its reachable band —
 * "if the cascade chose Archive at all, that is a recommendation". It
 * stays a floor rather than an always-true so a future re-weight that
 * lets Archive score lower is filtered, not silently endorsed.
 *
 * Keep and Unsubscribe hold D31's 0.85: Unsubscribe is destructive and
 * its band ([0.67, 0.92]) spends real spread on both sides of the bar.
 * `later` is the cascade's ABSTENTION — never a recommendation, so it
 * has no floor at all.
 */
export const RECOMMEND_FLOOR: Record<EngineVerdict, number | null> = {
  keep: 0.85,
  archive: 0.72,
  unsubscribe: 0.85,
  later: null,
};

/**
 * Whether this read is confident enough to present as a recommendation.
 *
 * Strict `>` per D31 — a row sitting exactly ON its floor does NOT
 * highlight ("highlight only when confidence > 0.85").
 */
export function isRecommended(verdict: EngineVerdict, confidence: number): boolean {
  const floor = RECOMMEND_FLOOR[verdict];
  return floor !== null && confidence > floor;
}

/** How sure the engine is, in words rather than a spurious percentage. */
export type ConfidenceBand = 'strong' | 'likely' | 'unsure';

/**
 * The band to render beside a verdict, or `null` when the verdict is an
 * abstention and there is nothing to be confident about.
 *
 * `strong` is DEFINED as `isRecommended`, so a pill's band and a row's
 * Recommended hint can never disagree about the same read.
 */
export function confidenceBand(verdict: EngineVerdict, confidence: number): ConfidenceBand | null {
  const floor = RECOMMEND_FLOOR[verdict];
  if (floor === null) return null;
  if (confidence > floor) return 'strong';
  if (confidence > floor - 0.1) return 'likely';
  return 'unsure';
}
