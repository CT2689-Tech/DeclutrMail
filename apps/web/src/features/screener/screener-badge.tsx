'use client';

import { useEffect, useRef, useState } from 'react';
import { tokens } from '@declutrmail/shared';

const { color, font, radius } = tokens;

/**
 * Screener sidebar badge (D74) — pending count with a subtle teal
 * pulse when the count INCREASES during an active session (a new
 * sender just landed), settling to a static count after ~1.5s. The
 * pulse respects `prefers-reduced-motion` via the media query inside
 * the keyframes <style> block. Renders nothing at 0 — a calm sidebar
 * is the resting state.
 *
 * MOUNTING (U-NAV owns the sidebar): pair with `useScreenerCount`
 * (./api/use-screener) where the shell composes its `counts`, or
 * render this component directly in a nav row slot. This unit ships
 * the hook + component only; the sidebar itself is not edited here.
 */
export function ScreenerBadge({ count }: { count: number }) {
  const prev = useRef(count);
  const [pulsing, setPulsing] = useState(false);

  useEffect(() => {
    if (count > prev.current) {
      setPulsing(true);
      const t = setTimeout(() => setPulsing(false), 1_500);
      return () => clearTimeout(t);
    }
    prev.current = count;
    return undefined;
  }, [count]);

  useEffect(() => {
    prev.current = count;
  }, [count]);

  if (count <= 0) return null;

  return (
    <>
      <style>{`
        @keyframes dm-screener-pulse {
          0% { box-shadow: 0 0 0 0 rgba(0,107,95,0.45); }
          70% { box-shadow: 0 0 0 6px rgba(0,107,95,0); }
          100% { box-shadow: 0 0 0 0 rgba(0,107,95,0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .dm-screener-badge { animation: none !important; }
        }
      `}</style>
      <span
        className="dm-screener-badge"
        aria-label={`${count} new sender${count === 1 ? '' : 's'} waiting in Screener`}
        style={{
          fontFamily: font.mono,
          fontSize: 10,
          fontWeight: 600,
          padding: '1px 6px',
          borderRadius: radius.pill,
          background: pulsing ? color.primarySoft : color.mutedBg,
          color: pulsing ? color.primary : color.fgMuted,
          transition: 'background 0.3s, color 0.3s',
          animation: pulsing ? 'dm-screener-pulse 1.5s ease-out 1' : 'none',
        }}
      >
        {count}
      </span>
    </>
  );
}
