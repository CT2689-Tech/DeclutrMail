'use client';

import { tokens } from '@declutrmail/shared';
import { scoredAgeLabel } from '@declutrmail/shared/copy';
import { useNow } from '@/lib/use-now';
import type { Recommendation, Verdict } from './types';

const { color, font, text } = tokens;

/**
 * Canonical user-facing label per verdict — K/A/U/L/D (CLAUDE.md §2.2,
 * ADR-0019). Total over `Verdict`, so adding a verb without labelling it
 * is a compile error rather than a blank banner.
 *
 * `delete` is never *recommended* — `VERB_REGISTRY` marks it
 * `canBePrimary: false`, so the scoring layer cannot select it. The entry
 * exists because the type is total, not because the banner will show it.
 */
const VERDICT_LABEL: Record<Verdict, string> = {
  keep: 'Keep',
  archive: 'Archive',
  unsubscribe: 'Unsubscribe',
  later: 'Later',
  delete: 'Delete',
};

/**
 * Optional sender suggestion (D245).
 *
 * Suggestions are collapsed secondary disclosure below the factual
 * action toolbar. Confidence is deliberately absent: it neither selects
 * nor styles an action. Expanding shows the suggested verb and the
 * observed facts behind it; the user remains free to choose any action.
 *
 * The collapsed summary carries the verb AND the age of the read, and
 * the reasoning stays behind the click, because the engine's copy is a
 * paragraph, not a phrase — 302 characters on average across the
 * founder's 8,531 scored senders, 507 at the longest. Inlining that
 * under the toolbar would bury the actions it is supposed to sit
 * beside; hiding the age would let a months-old read pass as current.
 */

export function RecommendationBanner({
  recommendation,
  toolbarHighlight,
}: {
  recommendation: Recommendation | null;
  /**
   * QA-sender-detail-20260902-07: the toolbar's fact-derived primary verb
   * (`derivePrimaryVerbId`) and this banner's engine suggestion are two
   * independently-sourced signals that can disagree with no explanation
   * of which is which. Optional so existing callers (Storybook, other
   * fixtures) don't need updating to keep compiling; `undefined` and
   * `null` both render the pre-existing copy.
   */
  toolbarHighlight?: Verdict | null;
}) {
  if (recommendation == null) return null;

  const { verdict, reasoning, signals, scoredAt } = recommendation;
  const verbLabel = VERDICT_LABEL[verdict];
  // Hydration-safe clock. `/senders/[id]` server-renders and hydrates
  // this component, so a bare `new Date()` in the render body gives the
  // server and the browser two different clocks — across a day boundary
  // the label flips from "today" to "yesterday" and React logs a
  // mismatch (D200). `useNow()` returns null until mount; the age is
  // decoration and can wait one tick. Same guard the triage and
  // screener rows use; this was the last surface without it.
  const now = useNow();
  // QA-sender-detail-20260902-08: this surface used to build its own
  // " · scored X" string from the lower-level `scoredAge`, while Triage
  // and the Screener called the shared `scoredAgeLabel` — three copies of
  // one fact, one already drifted. Calling the same function here means
  // fixing the word "scored" is a one-place change again.
  const age = scoredAt && now !== null ? scoredAgeLabel(scoredAt, new Date(now)) : null;
  const disagreesWithToolbar = toolbarHighlight != null && toolbarHighlight !== verdict;

  return (
    <details
      aria-label={`Optional suggestion: ${verbLabel}`}
      style={{ color: color.fg, fontFamily: font.sans }}
    >
      {/* A quiet line, not a card: the filled verb above is the page's one
          call to action, and this is the engine's separate read (D245). */}
      <summary
        style={{
          cursor: 'pointer',
          color: color.fgMuted,
          fontSize: text.sm,
        }}
      >
        Suggestion · <span style={{ color: color.fgSoft, fontWeight: 600 }}>{verbLabel}</span>
        {disagreesWithToolbar && <> — highlighted button is {VERDICT_LABEL[toolbarHighlight]}</>}
        {age && <> · {age}</>}
      </summary>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          padding: '8px 0 0',
        }}
      >
        <p style={{ margin: 0, fontSize: text.md, lineHeight: 1.55 }}>{reasoning}</p>
        {signals.length > 0 && (
          <ul
            aria-label="Details used"
            style={{
              margin: 0,
              padding: '0 0 0 18px',
              fontSize: text.sm,
              color: color.fgSoft,
              lineHeight: 1.55,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            {signals.map((signal) => (
              <li key={signal}>{signal}</li>
            ))}
          </ul>
        )}
        {/* QA-sender-detail-20260902-12: "this suggestion does not change
            email" was the third statement of that fact on one screen —
            "Optional suggestion" above and the toolbar's own safety hint
            both already say it. Cut, not reworded. */}
      </div>
    </details>
  );
}
