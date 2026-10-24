'use client';

import { SWIPE_HINT, tokens, type SwipeVerb } from '@declutrmail/shared';

const { color, text } = tokens;

/**
 * Live gesture feedback (ADR-0048): while a touch drag would resolve to a
 * verb, name it over the card so releasing is informed. The parent must
 * be `position: relative`.
 */
export function SwipeOverlay({ verb }: { verb: SwipeVerb }) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: color.card,
        opacity: 0.92,
        pointerEvents: 'none',
        zIndex: 2,
      }}
    >
      <span
        style={{
          fontSize: text.lg,
          fontWeight: 600,
          color: verb === 'Keep' ? color.primary : verb === 'Delete' ? color.dangerText : color.fg,
        }}
      >
        {SWIPE_HINT[verb]}
      </span>
    </div>
  );
}
