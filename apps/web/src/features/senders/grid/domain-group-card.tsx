'use client';

/**
 * `DomainGroupCard` — one brand-rollup group row on the senders grid
 * (D51 — eTLD+1 grouping). Renders the shared registrable domain +
 * aggregate counts (senders · 90d volume · received total) and an
 * expand control; the members render as ordinary `SenderCard`s when
 * expanded (the grid owns that — this card is just the header row).
 *
 * Group-level ACTIONS are deliberately absent in v1: expansion +
 * per-sender actions only, so every mutation keeps its per-sender D226
 * preview semantics. A group verb row is a later slice.
 *
 * Chrome matches `SenderCard` (ADR-0016 §A2 — neutral hairline, no
 * tone-wash) so the grid reads as one surface.
 */

import { Avatar, NumericDisplay, tokens } from '@declutrmail/shared';
import { fmtCompact } from '../data';

const { color, font, radius } = tokens;

export interface DomainGroupCardProps {
  /** Registrable domain the members share (eTLD+1). */
  domain: string;
  senderCount: number;
  /** Sum of members' last-90d volume (the engine's window, ADR-0037). */
  volume90d: number;
  /** Sum of members' received totals (`senders.total_received` — within retention, not all-time). */
  totalReceived: number;
  expanded: boolean;
  onToggleExpand: () => void;
}

export function DomainGroupCard({
  domain,
  senderCount,
  volume90d,
  totalReceived,
  expanded,
  onToggleExpand,
}: DomainGroupCardProps) {
  return (
    <article
      data-testid={`domain-group-${domain}`}
      style={{
        background: color.card,
        border: `1px solid ${expanded ? color.fgSoft : color.line}`,
        borderRadius: radius.md,
        padding: '18px 18px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        minHeight: 240,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <Avatar name={domain} domain={domain} size={40} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: font.sans,
              fontSize: 14,
              fontWeight: 600,
              color: color.fg,
              letterSpacing: '-0.005em',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {domain}
          </div>
          <div
            style={{
              fontFamily: font.mono,
              fontSize: 10.5,
              color: color.fgMuted,
              marginTop: 1,
            }}
          >
            domain group
          </div>
        </div>
        <span
          style={{
            fontFamily: font.mono,
            fontSize: 9.5,
            letterSpacing: '0.10em',
            textTransform: 'uppercase',
            color: color.fgSoft,
            background: color.paper,
            border: `1px solid ${color.line}`,
            borderRadius: 999,
            padding: '1px 6px',
            flex: '0 0 auto',
            whiteSpace: 'nowrap',
          }}
        >
          {senderCount} senders
        </span>
      </div>

      <div>
        {/* QA-senders-20260901-06: dropped the 3-cell stat grid below —
            "Senders" and "90d volume" repeated the pill above and this
            line verbatim; "Received" (never "all-time" — ADR-0014
            §Neutral) was the only new fact, so it rides this line instead. */}
        <NumericDisplay
          value={volume90d}
          suffix={`in last 90d · ${fmtCompact(totalReceived)} received`}
          variant="display"
        />
      </div>

      <span style={{ flex: 1 }} />

      <button
        type="button"
        onClick={onToggleExpand}
        aria-expanded={expanded}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          height: 32,
          padding: '0 14px',
          background: expanded ? color.fg : 'transparent',
          color: expanded ? color.fgInverse : color.fg,
          border: `1px solid ${expanded ? color.fg : color.line}`,
          borderRadius: 7,
          fontFamily: font.sans,
          fontSize: 12.5,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        {expanded ? 'Hide senders ▴' : `Show ${senderCount} senders ▾`}
      </button>
    </article>
  );
}
