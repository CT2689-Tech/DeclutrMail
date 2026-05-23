'use client';

import { useId, useState } from 'react';
import { Eyebrow, Pill, tokens } from '@declutrmail/shared';
import type { Recommendation, Verdict } from './types';

const { color, font, radius, shadow } = tokens;

/** Canonical user-facing label per verdict — K/A/U/L (D227). */
const VERDICT_LABEL: Record<Verdict, string> = {
  keep: 'Keep',
  archive: 'Archive',
  unsubscribe: 'Unsubscribe',
  later: 'Later',
};

/**
 * Recommendation banner (D39 #2, D26).
 *
 * Slim row above the action toolbar that surfaces the engine's
 * verdict + confidence + a "Why?" affordance. Clicking "Why?" opens
 * a popover with the reasoning + supporting signals.
 *
 * D31 highlights high-confidence (≥0.85) verdicts via the `dark`
 * pill tone — visually distinct from neutral suggestions.
 */
export function RecommendationBanner({
  recommendation,
}: {
  recommendation: Recommendation | null;
}) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const popoverId = useId();

  if (recommendation == null) {
    // Suppressed for VIP / Protected senders — D42's "no re-suggest" rule.
    return (
      <div
        role="status"
        style={{
          padding: '10px 14px',
          background: color.primaryWash,
          border: `1px solid ${color.primaryBorder}`,
          borderRadius: radius.md,
          color: color.fgSoft,
          fontSize: 12.5,
          fontFamily: font.sans,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <Eyebrow tone="primary">No recommendation</Eyebrow>
        <span>This sender is locked to Keep by a standing policy (VIP or Protect).</span>
      </div>
    );
  }

  const { verdict, confidence, reasoning, signals } = recommendation;
  const pct = Math.round(confidence * 100);
  const isHigh = confidence >= 0.85;
  const verbLabel = VERDICT_LABEL[verdict];

  return (
    <div
      role="region"
      aria-label="Recommendation"
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 14px',
        background: color.card,
        border: `1px solid ${color.line}`,
        borderRadius: radius.md,
        fontFamily: font.sans,
        flexWrap: 'wrap',
      }}
    >
      <Pill tone={isHigh ? 'dark' : 'default'}>
        <span aria-hidden="true">▼</span>
        {verbLabel} recommended
      </Pill>
      <span
        style={{
          fontFamily: font.mono,
          fontSize: 11,
          color: color.fgMuted,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        confidence {pct}%
      </span>
      <p
        style={{
          margin: 0,
          fontSize: 13,
          color: color.fg,
          lineHeight: 1.5,
          minWidth: 0,
          flex: 1,
        }}
      >
        “{reasoning}”
      </p>
      <button
        type="button"
        onClick={() => setPopoverOpen((v) => !v)}
        aria-expanded={popoverOpen}
        aria-controls={popoverId}
        style={{
          background: 'transparent',
          border: `1px solid ${color.border}`,
          borderRadius: radius.sm,
          padding: '4px 10px',
          fontFamily: font.sans,
          fontSize: 12,
          fontWeight: 600,
          color: color.fgSoft,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        Why? →
      </button>

      {popoverOpen && (
        <div
          id={popoverId}
          role="dialog"
          aria-label="Why we recommend this"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 12,
            zIndex: 20,
            width: 'min(360px, calc(100vw - 32px))',
            background: color.card,
            border: `1px solid ${color.border}`,
            borderRadius: radius.lg,
            boxShadow: shadow.pop,
            padding: 16,
            fontFamily: font.sans,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Eyebrow tone={isHigh ? 'primary' : 'default'}>Why {verbLabel}?</Eyebrow>
            <button
              type="button"
              onClick={() => setPopoverOpen(false)}
              aria-label="Close"
              style={{
                background: 'transparent',
                border: 'none',
                color: color.fgMuted,
                cursor: 'pointer',
                padding: 0,
                fontSize: 16,
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: color.fg }}>{reasoning}</p>
          <ul
            style={{
              margin: 0,
              padding: '0 0 0 18px',
              fontSize: 12.5,
              color: color.fgSoft,
              lineHeight: 1.55,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            {signals.map((sig) => (
              <li key={sig}>{sig}</li>
            ))}
          </ul>
          <div
            style={{
              fontFamily: font.mono,
              fontSize: 10.5,
              color: color.fgMuted,
              borderTop: `1px solid ${color.lineSoft}`,
              paddingTop: 8,
              marginTop: 2,
            }}
          >
            Confidence {pct}% · derived from observed signals only — no category prediction.
          </div>
        </div>
      )}
    </div>
  );
}
