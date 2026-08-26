/**
 * Deterministic reasoning copy (D24 template fallback).
 *
 * Pure string building over a `CascadeResult` — no LLM, no clock, no IO.
 * Lives beside the cascade because both the score worker and the public
 * inbox simulator render it; the LLM path (`ReasoningLlmPort`, the
 * limiter and the env resolvers) stays in `packages/workers/src/reasoning.ts`,
 * which is server-only.
 *
 * The template copy follows D24's spec verbatim:
 *
 *     "{name} sends {N}/mo. {pct}% marked read over 90d. Recommended: {verdict}."
 *
 * For Phase A and Phase B (no scoring) the template degrades gracefully —
 * "{name} sends {N}/mo." is kept and the second clause swaps to the
 * cascade's audit phrase (e.g. "Kept because you've written to them.").
 */
import type { CascadeResult, CascadeRuleId } from './cascade';
import type { TriageVerdict } from '../contracts/triage-enums';

/**
 * Per-rule audit phrase — the second clause of the template.
 *
 * `satisfies Record<CascadeRuleId, string>` makes the map exhaustive: a
 * new cascade rule added to `CascadeRuleId` without a phrase entry here
 * is a compile error, not a silent fallthrough.
 */
const RULE_PHRASE = {
  protect_user_defined: "Kept because you've marked them as protected.",
  protect_replied:
    "Protected because you've written to this sender at least three times and heard back.",
  protect_starred: "Protected because you've starred a message from this sender this year.",
  protect_gmail_important:
    'Protected because Gmail marked at least three messages from this Primary-inbox sender important this year.',
  wrote_to_at_least_once: "Kept because you've written to them.",
  gmail_primary: 'Kept because Gmail puts them in your Primary inbox.',
  starred_recently: "Kept because you've starred a message from them this year.",
  high_read_rate: 'Kept because you open more than half of their messages.',
  long_relationship_engaged: 'Kept because of a long, engaged relationship.',
  insufficient_signal: 'Recommended: decide later — not enough signal yet.',
  score_archive: 'Recommended: archive to keep them out of your inbox.',
  score_unsubscribe: 'Recommended: unsubscribe to stop the stream.',
  score_inconclusive: 'Recommended: decide later — signals are mixed.',
  score_no_unsub_channel: 'Recommended: decide later — this sender offers no unsubscribe link.',
  score_quiet_stream:
    'Recommended: decide later — too quiet a stream to be worth unsubscribing from.',
} as const satisfies Record<CascadeRuleId, string>;

/**
 * The verb shown in the "Recommended:" sentence (matches K/A/U/L copy).
 *
 * `satisfies` (instead of `: Record<TriageVerdict, string>`) means a new
 * verdict literal added to the `TriageVerdict` union causes a compile
 * error AT THIS MAP — exhaustiveness is enforced where it matters. D227
 * pins the four verbs (Keep · Archive · Unsubscribe · Later) so this
 * map is the single source of truth for the user-facing label.
 */
export const VERDICT_LABEL = {
  keep: 'Keep',
  archive: 'Archive',
  unsubscribe: 'Unsubscribe',
  later: 'Later',
} as const satisfies Record<TriageVerdict, string>;

/**
 * Render the deterministic template (D24 fallback). Stable, body-free,
 * LLM-free.
 *
 * `displayName` falls back to the bare email's local-part when empty —
 * the prior pattern in `senders.display_name` defaults to `''` for bare
 * addresses, and a missing name in the template reads as a bug to the
 * user.
 */
export function renderTemplate(displayName: string, result: CascadeResult): string {
  const name = displayName.trim() || 'This sender';
  const monthlyVol = result.facts.monthlyVolume;
  const readPct = result.facts.readRatePct;
  // No `??` fallback. Both lookups are total at compile time:
  //   - `RULE_PHRASE` satisfies `Record<CascadeRuleId, string>`
  //   - `VERDICT_LABEL` satisfies `Record<TriageVerdict, string>`
  // A new rule id or verdict is a compile error at the map above, not a
  // runtime fallthrough here.
  const phrase = RULE_PHRASE[result.ruleId];

  // For Phase A "Keep" rules the read% / monthly volume aren't the point
  // — the audit phrase is. The two-clause shape keeps the template
  // recognisable across verdicts ("{name} sends {N}/mo. {phrase}").
  //
  // A null read rate DROPS the clause rather than printing 0%. The
  // sentence is addressed to the user about their own behaviour, so
  // "You open 0%." on a sender with no mail in the window is not a
  // rounding artefact — it is a false statement about them.
  if (readPct === null) {
    return `${name} sends ${monthlyVol}/mo. ${phrase}`;
  }
  // Two constraints, both learned the hard way.
  //
  // WINDOW: "over 90d", because the rate IS a 90-day ratio and "You open
  // 2%." reads as a standing fact about the reader rather than a
  // measurement of one quarter.
  //
  // VERB: "marked read", never "open". Gmail exposes no open event — only
  // the absence of the UNREAD label, which a filter, a bulk mark-as-read,
  // or a third-party sweeper (unroll.me, SaneBox) can strip without a
  // human ever seeing the message. D45 settled this: the column is
  // UNREAD-derived and could "never be populated honestly" as opens. This
  // sentence is the engine's justification for a recommendation, so
  // claiming an open we cannot observe is the worst place to do it.
  return `${name} sends ${monthlyVol}/mo. ${readPct}% marked read over 90d. ${phrase}`;
}
