'use client';

import { Eyebrow, tokens } from '@declutrmail/shared';
import type { AutopilotRuleDto } from '@/lib/api/autopilot';

const { color, font } = tokens;

/**
 * D105 — "Autopilot paused since [date]" banner.
 *
 * Visible when every Autopilot rule is in `mode = 'paused'`. The plan
 * defines the resume affordance as "click to resume" — that lives on
 * the per-rule controls in V2.1's full management UI. At launch (D104
 * dismiss + D105 pause-all only) the banner is purely informational;
 * resuming an individual rule requires the founder to flip its mode
 * via the BE (currently the only per-rule mutation surface is
 * `PATCH /api/autopilot/rules/:id` — wired in a follow-up UI PR).
 */
export function PausedBanner({ rules }: { rules: AutopilotRuleDto[] }) {
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
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: '12px 14px',
        background: color.paper,
        border: `1px dashed ${color.border}`,
        borderRadius: 10,
        fontFamily: font.sans,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 28,
          height: 28,
          borderRadius: 999,
          background: color.mutedBg,
          color: color.fgMuted,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="6" y="5" width="4" height="14" />
          <rect x="14" y="5" width="4" height="14" />
        </svg>
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Eyebrow>Autopilot paused</Eyebrow>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: color.fg,
            margin: '2px 0 0',
          }}
        >
          {lastChanged != null ? (
            <>Paused since {formatPauseDate(lastChanged)}.</>
          ) : (
            <>Every rule is paused.</>
          )}
        </div>
        <div
          style={{
            fontSize: 11.5,
            color: color.fgMuted,
            marginTop: 4,
            lineHeight: 1.5,
          }}
        >
          No new matches will land while every rule is paused. Re-enable a rule from the rules list
          to start observing again.
        </div>
      </div>
    </div>
  );
}

/** Compact human-readable date for the banner. Matches the senders Detail "last reviewed" eyebrow. */
function formatPauseDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
