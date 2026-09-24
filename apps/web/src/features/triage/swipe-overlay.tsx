'use client';

import { tokens } from '@declutrmail/shared';

import type { SwipeVerb } from './use-swipe-verb';

const { color, text } = tokens;

const SWIPE_LABEL: Record<SwipeVerb, string> = {
  Keep: '→ Keep',
  Archive: '← Archive',
  Later: '↑ Later',
};

/**
 * D37 — live gesture feedback: while a touch drag would resolve to a
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
          color: verb === 'Keep' ? color.primary : color.fg,
        }}
      >
        {SWIPE_LABEL[verb]}
      </span>
    </div>
  );
}
