'use client';

import { tokens } from '@declutrmail/shared';
import type { AutopilotRuleDto } from '@/lib/api/autopilot';
import { useNow } from '@/lib/use-now';
import { bannerSurface } from './autopilot-banner-stack';

const { color, text } = tokens;

/**
 * D105 — "Autopilot paused since [date]" banner.
 *
 * Visible when every Autopilot rule is in `mode = 'paused'`. Purely
 * informational — Resume lives on each rule row below.
 */
export function PausedBanner({ rules }: { rules: AutopilotRuleDto[] }) {
  const now = useNow();
  // Source-of-truth for "paused since" is the latest `modeChangedAt`
  // across all rules — the global pause-all flipped each row's
  // `mode_changed_at` to the same instant, so any rule's value is a
  // valid proxy. Picking the max defends against clock skew between
  // partial pauses (founder paused 4 rules, then later paused the 5th).
  const lastChanged = rules.reduce<string | null>((acc, r) => {
    if (r.mode !== 'paused') return acc;
    if (acc == null || r.modeChangedAt > acc) return r.modeChangedAt;
    return acc;
  }, null);

  return (
    <div
      role="status"
      aria-live="polite"
      style={{ ...bannerSurface, fontSize: text.md, color: color.fgSoft }}
    >
      <strong style={{ color: color.fg, fontWeight: 600 }}>
        {lastChanged != null && now !== null ? (
          <>Paused since {formatPauseDate(lastChanged)}.</>
        ) : (
          <>Every rule is paused.</>
        )}
      </strong>{' '}
      Resume a rule below to start again.
    </div>
  );
}

/**
 * Compact human-readable date for the banner. Matches the senders
 * Detail "last reviewed" eyebrow. Locale pinned for consistency with
 * every other label (the line is gated on `now !== null`, so it never
 * reaches server HTML); the zone stays the browser's, and tests pass
 * an explicit one for exact-string determinism. Exported for the unit
 * test.
 */
export function formatPauseDate(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone,
  });
}
