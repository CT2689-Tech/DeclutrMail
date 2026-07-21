'use client';

import type { ReactNode } from 'react';
import { isValidElement } from 'react';

import { color, font, radius } from '../tokens/tokens';
import { useLabels, type LabelKey } from '../hooks/use-labels';

interface NavItem {
  id: LabelKey;
  /** SVG path `d` for a 24×24 stroked icon. */
  icon: string;
}

interface NavGroup {
  heading: string | null;
  items: NavItem[];
}

// Honest nav (U-NAV, D207): the sidebar lists ONLY surfaces that are
// real on main. `screener` (PR #220) and `billing` (PR #219) shipped,
// so their fb75b05-trimmed entries are restored verbatim below.
const NAV: NavGroup[] = [
  {
    heading: 'Decide',
    items: [
      {
        id: 'senders',
        icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
      },
      { id: 'triage', icon: 'M3 6h18M6 12h12M9 18h6' },
      { id: 'screener', icon: 'M9 12l2 2 4-4M21 12c0 5-4 9-9 9s-9-4-9-9 4-9 9-9c1 0 2 0 3 .5' },
    ],
  },
  {
    heading: 'Automate',
    items: [
      { id: 'autopilot', icon: 'M12 2L2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5' },
      { id: 'quiet', icon: 'M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2' },
    ],
  },
  {
    heading: 'Review',
    items: [
      { id: 'brief', icon: 'M4 4h12l4 4v12a2 2 0 0 1-2 2H4zM14 4v4h6' },
      { id: 'followups', icon: 'M3 12h6l3-9 6 18 3-9h3' },
      { id: 'snoozed', icon: 'M12 6v6l4 2M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z' },
      { id: 'activity', icon: 'M3 12h4l3-9 4 18 3-9h4' },
    ],
  },
  {
    heading: 'Account',
    items: [
      { id: 'billing', icon: 'M2 6h20v12H2zM2 10h20' },
      {
        id: 'settings',
        icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
      },
    ],
  },
];

export function Sidebar({
  active,
  onNavigate,
  counts = {},
}: {
  active: string;
  onNavigate: (id: string) => void;
  /**
   * Per-item badge slot. A `string | number` renders the built-in
   * count pill; a React element renders as-is (bring-your-own badge —
   * the web app mounts its D74 `ScreenerBadge` this way).
   */
  counts?: Partial<Record<string, string | number | ReactNode>>;
}) {
  const labels = useLabels();
  return (
    <aside
      style={{
        width: 220,
        flexShrink: 0,
        height: '100%',
        overflow: 'auto',
        borderRight: `1px solid ${color.border}`,
        background: color.paper,
        padding: '14px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        fontFamily: font.sans,
      }}
    >
      {/* Brand */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          padding: '4px 6px',
        }}
      >
        <span
          style={{
            width: 26,
            height: 26,
            borderRadius: 7,
            background: `linear-gradient(135deg, ${color.primary}, ${color.mint})`,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: color.fgInverse,
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          D
        </span>
        <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em' }}>
          DeclutrMail
          <span style={{ color: color.primary }}>.com</span>
        </span>
      </div>

      <nav
        aria-label="Product navigation"
        style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        {NAV.map((group, gi) => {
          const headingId =
            group.heading == null
              ? undefined
              : `sidebar-group-${group.heading.toLowerCase()}-heading`;
          return (
            <section
              key={group.heading ?? `g${gi}`}
              aria-labelledby={headingId}
              style={{ display: 'flex', flexDirection: 'column', gap: 2 }}
            >
              {group.heading != null && (
                <h2
                  id={headingId}
                  style={{
                    margin: 0,
                    padding: '4px 10px 6px',
                    fontFamily: font.mono,
                    fontSize: 9.5,
                    fontWeight: 500,
                    color: color.fgMuted,
                    textTransform: 'uppercase',
                    letterSpacing: '0.14em',
                  }}
                >
                  {group.heading}
                </h2>
              )}
              {group.items.map((item) => {
                const on = active === item.id;
                const badge = counts[item.id];
                return (
                  <button
                    key={item.id}
                    onClick={() => onNavigate(item.id)}
                    aria-current={on ? 'page' : undefined}
                    onMouseEnter={(e) => {
                      if (!on) e.currentTarget.style.background = 'rgba(14,20,19,0.04)';
                    }}
                    onMouseLeave={(e) => {
                      if (!on) e.currentTarget.style.background = 'transparent';
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 9,
                      padding: '6px 10px',
                      borderRadius: radius.sm,
                      border: 'none',
                      background: on ? color.primarySoft : 'transparent',
                      color: on ? color.primary : color.fg,
                      fontFamily: font.sans,
                      fontSize: 13,
                      fontWeight: on ? 600 : 500,
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'background 0.12s',
                    }}
                  >
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d={item.icon} />
                    </svg>
                    <span style={{ flex: 1 }}>{labels[item.id]}</span>
                    {badge != null &&
                      (isValidElement(badge) ? (
                        badge
                      ) : (
                        <span
                          style={{
                            fontFamily: font.mono,
                            fontSize: 10,
                            fontWeight: 600,
                            padding: '1px 6px',
                            borderRadius: radius.pill,
                            background: on ? color.primary : color.mutedBg,
                            color: on ? color.fgInverse : color.fgMuted,
                          }}
                        >
                          {badge}
                        </span>
                      ))}
                  </button>
                );
              })}
            </section>
          );
        })}
      </nav>
    </aside>
  );
}
