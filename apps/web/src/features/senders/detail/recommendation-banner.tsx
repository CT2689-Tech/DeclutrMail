'use client';

import { Eyebrow, tokens } from '@declutrmail/shared';
import { scoredAgeLabel } from '@declutrmail/shared/copy';
import { useNow } from '@/lib/use-now';
import type { Recommendation, Verdict } from './types';

const { color, font, radius } = tokens;

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
      style={{
        background: color.card,
        border: `1px solid ${color.line}`,
        borderRadius: radius.md,
        color: color.fg,
        fontFamily: font.sans,
      }}
    >
      <summary
        style={{
          cursor: 'pointer',
          padding: '10px 14px',
          color: color.fgSoft,
          fontSize: 12.5,
          fontWeight: 600,
        }}
      >
        Optional suggestion · {verbLabel}
        {disagreesWithToolbar && (
          <span style={{ fontWeight: 500, color: color.fgMuted }}>
            {' '}
            — highlighted button is {VERDICT_LABEL[toolbarHighlight]}
          </span>
        )}
        {age && <span style={{ fontWeight: 500, color: color.fgMuted }}> · {age}</span>}
      </summary>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          padding: '12px 14px 14px',
          borderTop: `1px solid ${color.lineSoft}`,
        }}
      >
        <div>
          {/* QA-sender-detail-20260902-12: "Suggested action" labelled the
              REASONING paragraph below it, which explains the suggestion,
              not an action itself. */}
          <Eyebrow tone="default">Why</Eyebrow>
          <p style={{ margin: '5px 0 0', fontSize: 13, lineHeight: 1.55 }}>{reasoning}</p>
        </div>
        {signals.length > 0 && (
          <div>
            <Eyebrow tone="default">Details used</Eyebrow>
            <ul
              style={{
                margin: '6px 0 0',
                padding: '0 0 0 18px',
                fontSize: 12.5,
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
          </div>
        )}
        {/* QA-sender-detail-20260902-12: "this suggestion does not change
            email" was the third statement of that fact on one screen —
            "Optional suggestion" above and the toolbar's own safety hint
            both already say it. Cut, not reworded. */}
      </div>
    </details>
  );
}
