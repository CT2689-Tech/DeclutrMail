'use client';
// apps/web/src/features/senders/uplift-d/decision-timeline/decision-timeline.tsx
//
// Variant D decision timeline — feature-owned per ADR-0007 (lazy
// promotion). Replaces the table-style decision history in the Sender
// detail page (D46) per ADR-0012's detail-page composition patch on D39.
//
// Design intent (~/.claude/plans/how-can-we-uplift-foamy-cloud.md §D2):
// a vertical timeline with a connector line between events, "today"
// marker filled solid + soft halo, prior events outlined. Each item:
//   [when (relative, mono)]  [● node]  [what happened]
// Connector line drawn from the second item down through the last.
//
// The component is presentation-only. The consumer assembles the items
// from the existing triage_decisions + activity_log query results — no
// new schema, no new wire field. Per ADR-0012, the most-recent engine
// recommendation appears at the top; the rest is action history.

import type { ReactNode } from 'react';
import { tokens } from '@declutrmail/shared';

const { color, font, radius, shadow, text, space } = tokens;

export interface TimelineItem {
  /** Stable key for React reconciliation. */
  id: string;
  /**
   * Relative time label — "today", "3w ago", "2mo ago", "2yr ago".
   * The consumer formats this; the component just renders the string
   * mono-spaced in a fixed-width column.
   */
  when: ReactNode;
  /**
   * The event body. Use bold for the action verb ("You chose to
   * **Keep**"); use a secondary span for source / count / opId.
   *
   * @example
   *   <>
   *     Engine recommends <strong style={{color: 'amber'}}>Unsubscribe</strong>{' '}
   *     <span style={{color: 'muted'}}>· 89% confidence</span>
   *   </>
   */
  what: ReactNode;
  /**
   * Whether this is the "current" / "today" item. The top-most item is
   * typically `current=true`; node renders filled + with a soft teal
   * halo. Subsequent items render outlined-only.
   */
  current?: boolean;
}

export interface DecisionTimelineProps {
  /** Optional small heading above the timeline. */
  heading?: ReactNode;
  /**
   * Optional right-aligned affordance on the heading row — the detail
   * page passes a "View in Activity →" link so history dead-ends stop
   * at this card (2026-07-07 founder smoke feedback).
   */
  action?: ReactNode;
  /** Items rendered top → bottom (newest first by convention). */
  items: TimelineItem[];
}

/**
 * Vertical decision timeline — replaces the table-style history per
 * ADR-0012. Renders a connector line between items via an absolutely-
 * positioned ::after on each non-last row.
 */
export function DecisionTimeline({ heading, action, items }: DecisionTimelineProps) {
  return (
    <section
      style={{
        background: color.card,
        border: `1px solid ${color.line}`,
        borderRadius: radius.lg,
        padding: `${space[5]}px ${space[6]}px`,
        boxShadow: shadow.card,
        marginBottom: space[4],
        fontFamily: font.sans,
      }}
    >
      {(heading != null || action != null) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: space[3],
            marginBottom: space[4],
          }}
        >
          {heading != null && (
            <h3
              style={{
                fontSize: text.xs,
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                color: color.fgMuted,
                fontWeight: 500,
                margin: 0,
              }}
            >
              {heading}
            </h3>
          )}
          {action}
        </div>
      )}
      <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <li
              key={item.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '84px 18px 1fr',
                gap: space[3],
                padding: `${space[2]}px 0`,
                position: 'relative',
                alignItems: 'center',
              }}
            >
              <span
                style={{
                  fontSize: text.sm,
                  color: color.fgMuted,
                  fontVariantNumeric: 'tabular-nums',
                  fontFamily: font.mono,
                }}
              >
                {item.when}
              </span>
              <span
                aria-hidden
                style={{
                  width: 11,
                  height: 11,
                  borderRadius: '50%',
                  background: item.current ? color.primary : color.card,
                  border: `2px solid ${color.primary}`,
                  zIndex: 1,
                  marginLeft: 3,
                  boxShadow: item.current ? `0 0 0 4px ${color.primarySoft}` : 'none',
                  position: 'relative',
                }}
              />
              {/* connector line drawn from this node down to the next */}
              {!isLast && (
                <span
                  aria-hidden
                  style={{
                    position: 'absolute',
                    left: 92,
                    top: '50%',
                    width: 2,
                    height: '100%',
                    background: color.lineSoft,
                    zIndex: 0,
                  }}
                />
              )}
              <span
                style={{
                  fontSize: text.md,
                  lineHeight: 1.4,
                  color: color.fg,
                }}
              >
                {item.what}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
