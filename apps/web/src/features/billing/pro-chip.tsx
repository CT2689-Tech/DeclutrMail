'use client';

import { tokens } from '@declutrmail/shared';

const { color, font } = tokens;

/**
 * Sidebar plan chip — marks a nav item whose feature the current tier
 * has not unlocked, so users learn a surface is gated BEFORE clicking
 * into it (2026-07-10 founder dogfood: three paywalls and two gated
 * pages were indistinguishable from free surfaces in the nav).
 *
 * Rendered through the sidebar's bring-your-own-badge slot (the same
 * mechanism as the D74 ScreenerBadge), so the shared shell stays
 * entitlement-agnostic.
 */
export function PlanChip({ plan }: { plan: 'Plus' | 'Pro' }) {
  return (
    <span
      aria-label={`${plan} feature`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 16,
        padding: '0 6px',
        borderRadius: 999,
        border: `1px solid ${color.lineSoft}`,
        background: 'transparent',
        color: color.fgMuted,
        fontFamily: font.mono,
        fontSize: 9,
        fontWeight: 600,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
      }}
    >
      {plan}
    </span>
  );
}

/** Compatibility wrapper for existing Pro-only call sites. */
export function ProChip() {
  return <PlanChip plan="Pro" />;
}
