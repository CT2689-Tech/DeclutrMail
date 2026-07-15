'use client';

import { Eyebrow, tokens } from '@declutrmail/shared';
import type { Recommendation, Verdict } from './types';

const { color, font, radius } = tokens;

/** Canonical user-facing label per verdict — K/A/U/L (D227). */
const VERDICT_LABEL: Record<Verdict, string> = {
  keep: 'Keep',
  archive: 'Archive',
  unsubscribe: 'Unsubscribe',
  later: 'Later',
};

/**
 * Optional sender suggestion (D245).
 *
 * Suggestions are collapsed secondary disclosure below the factual
 * action toolbar. Confidence is deliberately absent: it neither selects
 * nor styles an action. Expanding shows the suggested verb and the
 * observed facts behind it; the user remains free to choose any action.
 */
export function RecommendationBanner({
  recommendation,
}: {
  recommendation: Recommendation | null;
}) {
  if (recommendation == null) return null;

  const { verdict, reasoning, signals } = recommendation;
  const verbLabel = VERDICT_LABEL[verdict];

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
        <div>
          <Eyebrow tone="default">Observed facts</Eyebrow>
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
        <p style={{ margin: 0, fontSize: 12, color: color.fgMuted, lineHeight: 1.5 }}>
          This suggestion does not change mail. Choose the action that fits.
        </p>
      </div>
    </details>
  );
}
