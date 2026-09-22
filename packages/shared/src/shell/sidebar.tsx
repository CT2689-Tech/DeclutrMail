'use client';

import { useEffect, useState } from 'react';
import { Logo } from '../components/logo';
import { font, motion, radius, text } from '../tokens/tokens';
import { useLabels, type LabelKey } from '../hooks/use-labels';

interface NavItem {
  id: LabelKey;
  /** SVG path `d` for a 24×24 stroked icon. */
  icon: string;
}

/**
 * A row's count. The object form carries a spoken label for counts whose
 * bare number would read ambiguously next to the row name ("Screener 3").
 */
export type NavCount = string | number | { text: string | number; label: string };

// Honest nav (U-NAV, D207): the sidebar lists ONLY surfaces that are
// real on main. One flat list in journey order — decide, automate,
// review. Billing and Settings live in the account menu: they are
// account chores, not places the daily ritual passes through.
export const NAV: readonly NavItem[] = [
  { id: 'home', icon: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10' },
  {
    id: 'senders',
    icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  },
  { id: 'triage', icon: 'M3 6h18M6 12h12M9 18h6' },
  { id: 'screener', icon: 'M9 12l2 2 4-4M21 12c0 5-4 9-9 9s-9-4-9-9 4-9 9-9c1 0 2 0 3 .5' },
  { id: 'autopilot', icon: 'M12 2L2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5' },
  { id: 'quiet', icon: 'M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2' },
  { id: 'brief', icon: 'M4 4h12l4 4v12a2 2 0 0 1-2 2H4zM14 4v4h6' },
  { id: 'followups', icon: 'M3 12h6l3-9 6 18 3-9h3' },
  { id: 'snoozed', icon: 'M12 6v6l4 2M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z' },
  { id: 'activity', icon: 'M3 12h4l3-9 4 18 3-9h4' },
];

export const SIDEBAR_WIDTH = 220;
export const SIDEBAR_RAIL_WIDTH = 72;

export function NavIcon({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <path d={d} />
    </svg>
  );
}

export function Sidebar({
  active,
  onNavigate,
  onNavigateIntent,
  counts = {},
  locks = {},
  collapsed = false,
  onToggleCollapsed,
  animateWidth = false,
}: {
  active: string;
  onNavigate: (id: string) => void;
  /**
   * Optional early navigation signal for framework hosts to prefetch a
   * destination before the click. Fired on pointer hover, keyboard focus,
   * and touch start; active destinations are ignored.
   */
  onNavigateIntent?: ((id: string) => void) | undefined;
  /** Per-item count, rendered as quiet numerals (a dot on the rail). */
  counts?: Partial<Record<string, NavCount>>;
  /**
   * Per-item lock: the name of the plan that unlocks the row ("Plus").
   * The shell stays entitlement-agnostic — the host decides what is
   * locked. Hidden at rest and revealed on row hover / keyboard focus
   * (tokens.css `.dm-nav-lock`); it stays in the accessibility tree
   * throughout, so a screen reader hears the gate without hovering.
   */
  locks?: Partial<Record<string, string>>;
  /** Icon-only rail. The mobile drawer never collapses. */
  collapsed?: boolean;
  /** Omit to render no collapse toggle (the mobile drawer). */
  onToggleCollapsed?: (() => void) | undefined;
  /**
   * Animate the width change. Off until the user toggles, so a persisted
   * rail does not visibly slide shut on every page load.
   */
  animateWidth?: boolean;
}) {
  const labels = useLabels();
  const [hint, setHint] = useState<{ label: string; top: number; left: number } | null>(null);
  useEffect(() => {
    if (!hint) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setHint(null);
    };
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, [hint]);
  const showHint = (element: HTMLButtonElement, label: string) => {
    if (!collapsed) return;
    const bounds = element.getBoundingClientRect();
    setHint({ label, left: bounds.right + 12, top: bounds.top });
  };
  return (
    <aside
      className="dm-editorial-sidebar"
      onScroll={() => setHint(null)}
      data-collapsed={collapsed ? 'true' : 'false'}
      style={{
        width: collapsed ? SIDEBAR_RAIL_WIDTH : SIDEBAR_WIDTH,
        flexShrink: 0,
        height: '100%',
        boxSizing: 'border-box',
        overflowX: 'hidden',
        overflowY: 'auto',
        // A quiet forest rail anchors the warm paper workspace.
        borderRight: '1px solid #ffffff0b',
        background: 'var(--dm-nav-bg)',
        padding: '24px 14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
        fontFamily: font.sans,
        ...(animateWidth ? { transition: `width ${motion.base} ${motion.ease}` } : {}),
      }}
    >
      {/* Hover is the neutral fill, not a line tone. The selector outranks
          tokens.css `.dm-nav-row:hover`; the active row's inline
          background outranks both. */}

      {/* Brand. ADR-0036 is the whole specification: the mark, the
          wordmark, the ratio between them and the tone belong to the
          component, not to this consumer. `size` is the only lever, and
          24 selects the compact cut (ADR-0036 §Two cuts) — the correct
          geometry at this size, and narrow enough that the lockup fits
          the 220px rail. The icon rail has room for the mark alone. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-start',
          height: 28,
          padding: collapsed ? 0 : '0 8px',
        }}
      >
        <Logo size={24} tone="reversed" variant={collapsed ? 'mark' : 'horizontal'} />
      </div>

      <nav
        aria-label="Product navigation"
        style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: 1 }}
      >
        {NAV.map((item) => {
          const on = active === item.id;
          const label = labels[item.id];
          const count = counts[item.id];
          const lock = locks[item.id];
          const lockLabel = lock == null ? undefined : `${lock} feature`;
          const countText = typeof count === 'object' ? count.text : count;
          const countLabel = typeof count === 'object' ? count.label : undefined;
          const railLabel = [label, lockLabel, countLabel ?? countText]
            .filter((value) => value != null)
            .join(', ');
          const signalNavigationIntent = () => {
            if (!on) onNavigateIntent?.(item.id);
          };
          return (
            <button
              key={item.id}
              type="button"
              className="dm-nav-row"
              onClick={() => onNavigate(item.id)}
              onFocus={(event) => {
                signalNavigationIntent();
                showHint(event.currentTarget, railLabel);
              }}
              onBlur={() => setHint(null)}
              onTouchStart={signalNavigationIntent}
              onMouseEnter={(event) => {
                signalNavigationIntent();
                showHint(event.currentTarget, railLabel);
              }}
              onMouseLeave={() => setHint(null)}
              aria-current={on ? 'page' : undefined}
              // The rail hides the label, so the row needs its name back;
              // visible hints also retain counts and plan-gate context.
              aria-label={collapsed ? railLabel : undefined}
              title={collapsed ? railLabel : undefined}
              style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: collapsed ? 'center' : 'flex-start',
                gap: 10,
                height: 42,
                flexShrink: 0,
                padding: collapsed ? 0 : '0 10px',
                borderRadius: radius.md,
                border: 'none',
                // Resting + hover backgrounds are CSS (`.dm-nav-row`) so
                // hover needs no JS and works in both themes. The active
                // item has a soft fill and a warm edge marker.
                ...(on
                  ? {
                      background: 'var(--dm-nav-active)',
                      boxShadow: 'inset 3px 0 var(--dm-nav-marker)',
                    }
                  : {}),
                color: on ? 'var(--dm-nav-fg)' : 'var(--dm-nav-muted)',
                fontFamily: font.sans,
                fontSize: text.md,
                fontWeight: on ? 600 : 500,
                letterSpacing: '-0.006em',
                cursor: 'pointer',
                textAlign: 'left',
                transition: `background ${motion.fast} ${motion.ease}`,
              }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  color: on ? 'var(--dm-nav-fg)' : 'var(--dm-nav-muted)',
                }}
              >
                <NavIcon d={item.icon} />
              </span>
              {!collapsed && (
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {label}
                </span>
              )}
              {!collapsed && lock != null && (
                <span
                  className="dm-nav-lock"
                  aria-label={lockLabel}
                  style={{ fontSize: text.xs, color: 'var(--dm-nav-muted)' }}
                >
                  {lock}
                </span>
              )}
              {countText != null &&
                (collapsed ? (
                  countText !== 0 &&
                  countText !== '0' && (
                    <span
                      aria-hidden="true"
                      data-testid={`nav-dot-${item.id}`}
                      style={{
                        position: 'absolute',
                        top: 8,
                        right: 12,
                        width: 6,
                        height: 6,
                        borderRadius: radius.pill,
                        background: 'var(--dm-nav-marker)',
                      }}
                    />
                  )
                ) : (
                  <span
                    aria-label={countLabel}
                    style={{
                      fontSize: text.sm,
                      fontWeight: 500,
                      fontVariantNumeric: 'tabular-nums',
                      color: 'var(--dm-nav-muted)',
                    }}
                  >
                    {countText}
                  </span>
                ))}
            </button>
          );
        })}
      </nav>

      {hint && collapsed && (
        <span aria-hidden="true" className="dm-nav-hint" style={{ top: hint.top, left: hint.left }}>
          {hint.label}
        </span>
      )}
      {onToggleCollapsed && (
        <button
          type="button"
          className="dm-nav-row"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            alignSelf: collapsed ? 'center' : 'flex-start',
            width: 32,
            height: 32,
            flexShrink: 0,
            padding: 0,
            borderRadius: radius.pill,
            border: 'none',
            color: 'var(--dm-nav-muted)',
            cursor: 'pointer',
            transition: `background ${motion.fast} ${motion.ease}`,
          }}
        >
          <NavIcon d={collapsed ? 'M9 6l6 6-6 6M4 4v16' : 'M15 6l-6 6 6 6M20 4v16'} size={16} />
        </button>
      )}
    </aside>
  );
}
