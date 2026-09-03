// @declutrmail/shared/copy — how old an engine read is, in words.
//
// `triage_decisions` stores `verdict` + `confidence` + `reasoning` at
// score time; every statistic rendered beside them is recomputed on
// each request. The two drift apart the moment a sender's mail changes,
// which is how a Triage card came to read "60 messages monthly, 1% read
// rate" next to a live "0% read in 90d · 209 messages" (founder,
// 2026-08-19).
//
// The product's answer is not to hide the old read — a queue that
// silently drops rows is worse than one that admits an age — but to let
// every surface that renders a recommendation state how old it is, in
// the same words. This lived inside `recommendation-banner.tsx` while
// Sender Detail was the only surface that knew about staleness; Triage
// and the Screener are the second and third.

/**
 * Human age of an engine read, e.g. `"3 weeks ago"`.
 *
 * `null` when the input is not a usable timestamp OR is in the future.
 * A future `scoredAt` is a clock disagreement, not an age — "scored in
 * -2 days" is worse than saying nothing, and callers already render the
 * label conditionally.
 *
 * Deliberately coarse. The number that matters to a reader is "is this
 * current or is this old", and a precise "17 days, 4 hours" invites
 * trust in a figure whose whole point is that it has decayed.
 *
 * Locale + zone independent by construction (pure arithmetic on the
 * elapsed span, no `toLocaleDateString`), so it cannot reintroduce the
 * D200 hydration-determinism class.
 *
 * @param iso ISO-8601 timestamp the read was produced at.
 * @param now Injectable clock — tests pass a fixed date.
 */
export function scoredAge(iso: string, now: Date = new Date()): string | null {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const days = Math.floor((now.getTime() - then) / 86_400_000);
  if (days < 0) return null;
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) {
    const weeks = Math.round(days / 7);
    return weeks === 1 ? 'a week ago' : `${weeks} weeks ago`;
  }
  if (days < 365) {
    const months = Math.round(days / 30);
    return months === 1 ? 'a month ago' : `${months} months ago`;
  }
  const years = Math.round(days / 365);
  return years === 1 ? 'a year ago' : `${years} years ago`;
}

/**
 * The full label a surface renders beside a recommendation.
 *
 * One function so Triage, the Screener and Sender Detail cannot drift
 * into three phrasings of the same fact — the drift that produced four
 * different ways of saying "read rate" across this codebase.
 *
 * Says only how old the read is. It deliberately does NOT say "stale",
 * "outdated" or "may be wrong": the read is the engine's best answer as
 * of that moment, and the age is the fact that lets a reader decide what
 * to make of it.
 */
export function scoredAgeLabel(iso: string, now: Date = new Date()): string | null {
  const age = scoredAge(iso, now);
  // QA-sender-detail-20260902-08: "scored" is the scoring engine's own
  // internal vocabulary — nothing else on any of the three consuming
  // surfaces (Sender Detail, Triage, Screener) calls this a "score", and
  // the user never sees the underlying number. "Last checked" says the
  // same fact (how old this read is) in the words the rest of the
  // product uses.
  return age === null ? null : `Last checked ${age}`;
}
