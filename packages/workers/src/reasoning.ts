import type { TriageVerdict } from '@declutrmail/db';

import type { CascadeResult } from './score-cascade.js';

/**
 * Reasoning (D24) — human-readable explanation of a `CascadeResult`.
 *
 * The verdict is deterministic (D21 cascade); the reasoning is the only
 * part the LLM touches, and even then in a strictly bounded way:
 *
 *   1. The PROMPT sees only sender metadata + cascade facts (display
 *      name, domain, monthly volume, read rate, Gmail category, the
 *      rule label). NEVER message bodies, NEVER subjects, NEVER
 *      snippets. D7 / D228 / D24 all converge here.
 *
 *   2. On LLM unavailability (no port wired, port throws, port returns
 *      empty), `renderTemplate` is the deterministic fallback — and the
 *      `triage_decisions.generated_by` column records `'template'` so
 *      observability can tell.
 *
 * The template copy follows D24's spec verbatim:
 *
 *     "{name} sends {N}/mo. You open {pct}%. Recommended: {verdict}."
 *
 * For Phase A and Phase B (no scoring) the template degrades gracefully —
 * "{name} sends {N}/mo." is kept and the second clause swaps to the
 * cascade's audit phrase (e.g. "Kept because you've replied to them.").
 */

/** Per-rule audit phrase — the second clause of the template. */
const RULE_PHRASE: Record<string, string> = {
  protect_user_defined: "Kept because you've marked them as protected.",
  protect_vip: "Kept because you've marked them VIP.",
  protect_engagement_based: 'Kept because of your engagement signals.',
  replied_at_least_once: "Kept because you've replied to them.",
  gmail_primary: 'Kept because Gmail puts them in your Primary inbox.',
  starred_recently: "Kept because you've starred a message from them this year.",
  high_read_rate: 'Kept because you open more than half of their messages.',
  long_relationship_engaged: 'Kept because of a long, engaged relationship.',
  insufficient_signal: 'Recommended: decide later — not enough signal yet.',
  score_archive: 'Recommended: archive to keep them out of your inbox.',
  score_unsubscribe: 'Recommended: unsubscribe to stop the stream.',
  score_inconclusive: 'Recommended: decide later — signals are mixed.',
};

/** The verb shown in the "Recommended:" sentence (matches K/A/U/L copy). */
const VERDICT_LABEL: Record<TriageVerdict, string> = {
  keep: 'Keep',
  archive: 'Archive',
  unsubscribe: 'Unsubscribe',
  later: 'Later',
};

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
  const phrase = RULE_PHRASE[result.ruleId] ?? `Recommended: ${VERDICT_LABEL[result.verdict]}.`;

  // For Phase A "Keep" rules the read% / monthly volume aren't the point
  // — the audit phrase is. The two-clause shape keeps the template
  // recognisable across verdicts ("{name} sends {N}/mo. {phrase}").
  return `${name} sends ${monthlyVol}/mo. You open ${readPct}%. ${phrase}`;
}

/**
 * LLM port (D24) — Haiku for explanation only. The composition root
 * (`apps/api/worker.ts`) wires a real implementation; the worker accepts
 * `undefined` to mean "no LLM available; always use the template."
 *
 * Implementations MUST:
 *   - NEVER receive message bodies or snippets. The `prompt` they see
 *     is the renderer's bounded string already.
 *   - Return `null` on any failure (timeout, rate limit, content filter,
 *     non-2xx). The worker falls back to the template on `null`. No
 *     throws — the LLM is a soft path.
 *   - Return the LLM's 1-2 sentence explanation as a UTF-8 string. The
 *     worker stores it verbatim into `triage_decisions.reasoning`.
 */
export interface ReasoningLlmPort {
  /**
   * Generate a 1-2 sentence explanation for one (sender, cascade result).
   * Returns `null` if the LLM call fails for any reason — the worker
   * falls back to the template.
   */
  explain(input: ReasoningInput): Promise<string | null>;
}

/**
 * The bounded payload the LLM port sees. By passing pre-computed facts
 * instead of raw `mail_messages` / `senders` rows, the port impl cannot
 * accidentally read body fields.
 */
export interface ReasoningInput {
  displayName: string;
  domain: string;
  verdict: TriageVerdict;
  confidence: number;
  ruleLabel: CascadeResult['ruleId'];
  facts: CascadeResult['facts'];
  gmailCategory: 'primary' | 'promotions' | 'social' | 'updates' | 'forums';
}
