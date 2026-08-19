'use client';

import { Eyebrow, tokens } from '@declutrmail/shared';
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
/**
 * How long ago the engine looked, in words. Rendered because re-scoring
 * is trigger-driven against a 7-day TTL: most stored verdicts are older
 * than that, and a months-old read presented without its age is the
 * same untruth as history that never happened.
 *
 * Locale + zone independent by construction (pure arithmetic on the
 * elapsed span, no `toLocaleDateString`), so it cannot reintroduce the
 * D200 hydration-determinism class.
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

export function RecommendationBanner({
  recommendation,
}: {
  recommendation: Recommendation | null;
}) {
  if (recommendation == null) return null;

  const { verdict, reasoning, signals, scoredAt } = recommendation;
  const verbLabel = VERDICT_LABEL[verdict];
  const age = scoredAt ? scoredAge(scoredAt) : null;

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
        {age && <span style={{ fontWeight: 500, color: color.fgMuted }}> · scored {age}</span>}
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
          <Eyebrow tone="default">Suggested action</Eyebrow>
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
        <p style={{ margin: 0, fontSize: 12, color: color.fgMuted, lineHeight: 1.5 }}>
          This suggestion does not change mail. Choose the action that fits.
        </p>
      </div>
    </details>
  );
}
