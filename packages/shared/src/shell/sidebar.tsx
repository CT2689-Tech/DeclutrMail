'use client';

import { useEffect, useState } from 'react';
import { Logo } from '../components/logo';
import { WS2_COPY } from '../copy/launch/ws2';
import { BILLING_NAME, BRIEF_NAME, CATCH_UP_LATER_FIRST } from '../copy/screen-decisions';
import { font, motion, radius, text } from '../tokens/tokens';
import { NAV_GROUP, useLabels, type LabelKey } from '../hooks/use-labels';

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

// Every real destination remains available in section navigation and the
// expanded navigation. The desktop rail uses the approved five groups.
export const NAV: readonly NavItem[] = [
  { id: 'home', icon: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10' },
  {
    id: 'senders',
    icon: 'M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8m5 10v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  },
  { id: 'triage', icon: 'M3 6h18M6 12h12M9 18h6' },
  { id: 'screener', icon: 'M9 12l2 2 4-4M21 12c0 5-4 9-9 9s-9-4-9-9 4-9 9-9c1 0 2 0 3 .5' },
  { id: 'autopilot', icon: 'M12 2L2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5' },
  { id: 'quiet', icon: 'M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2' },
  { id: 'brief', icon: 'M4 4h12l4 4v12a2 2 0 0 1-2 2H4zM14 4v4h6' },
  { id: 'followups', icon: 'M4 4h16v12H9l-5 4V4Zm4 4h8M8 12h5' },
  { id: 'snoozed', icon: 'M12 6v6l4 2M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z' },
  { id: 'activity', icon: 'M3 12h4l3-9 4 18 3-9h4' },
];

const CATCH_UP_LATER_ORDER = [
  'snoozed',
  'brief',
  'followups',
] as const satisfies readonly LabelKey[];
const CATCH_UP_BRIEF_ORDER = [
  'brief',
  'followups',
  'snoozed',
] as const satisfies readonly LabelKey[];
const CATCH_UP_MEMBERS = CATCH_UP_LATER_FIRST ? CATCH_UP_LATER_ORDER : CATCH_UP_BRIEF_ORDER;

export const WORKSPACE_NAV = [
  { id: 'home', label: 'Home', icon: 'm3 10 9-7 9 7v10H3V10Zm6 10v-7h6v7', members: ['home'] },
  {
    id: 'senders',
    label: NAV_GROUP,
    icon: 'M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8m5 10v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
    members: ['senders', 'triage', 'screener'],
  },
  {
    id: 'autopilot',
    label: 'Automations',
    icon: 'm13 2-9 12h7l-1 8 10-12h-7l1-8Z',
    members: ['autopilot', 'quiet'],
  },
  {
    id: 'brief',
    label: 'Catch up',
    icon: 'M3 4h7l2 2 2-2h7v15h-7l-2 2-2-2H3V4Zm9 2v15',
    members: CATCH_UP_MEMBERS,
  },
  { id: 'activity', label: 'Activity', icon: 'M3 12h4l3-8 4 16 3-8h4', members: ['activity'] },
] as const satisfies readonly {
  id: LabelKey;
  label: string;
  icon: string;
  members: readonly LabelKey[];
}[];

export function workspaceSection(active: string) {
  return WORKSPACE_NAV.find((section) => (section.members as readonly string[]).includes(active));
}

export const SIDEBAR_WIDTH = 220;
export const SIDEBAR_RAIL_WIDTH = 72;

export function NavIcon({ d, size = 20 }: { d: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
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
  responsive = false,
  hrefFor,
}: {
  active: string;
  onNavigate: (id: string) => void;
  onNavigateIntent?: ((id: string) => void) | undefined;
  counts?: Partial<Record<string, NavCount>>;
  locks?: Partial<Record<string, string>>;
  /** Compact five-section rail; false renders a labelled feature list. */
  collapsed?: boolean;
  /** Five workspace groups: labelled at desktop widths, compact on tablets. */
  responsive?: boolean;
  /** Framework host supplies real URLs for account navigation links. */
  hrefFor?: ((id: string) => string) | undefined;
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
  const showHint = (element: HTMLElement, label: string) => {
    if (!collapsed && !responsive) return;
    const bounds = element.getBoundingClientRect();
    if (responsive && bounds.width > 60) return;
    setHint({ label, left: bounds.right + 12, top: bounds.top });
  };
  const grouped = collapsed || responsive;
  const labelled = !collapsed || responsive;
  const items = grouped ? WORKSPACE_NAV : NAV;
  return (
    <aside
      className={`dm-editorial-sidebar${responsive ? ' dm-responsive-sidebar' : ''}`}
      aria-label="Workspace navigation"
      onScroll={() => setHint(null)}
      data-collapsed={collapsed ? 'true' : 'false'}
      style={{
        width: responsive ? undefined : collapsed ? SIDEBAR_RAIL_WIDTH : SIDEBAR_WIDTH,
        flexShrink: 0,
        height: '100%',
        boxSizing: 'border-box',
        overflowX: 'hidden',
        overflowY: 'hidden',
        background: 'var(--dm-nav-bg)',
        borderRight: '1px solid var(--dm-nav-active)',
        padding: '22px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 28,
        fontFamily: font.sans,
      }}
    >
      <button
        type="button"
        className="dm-rail-brand"
        aria-label="DeclutrMail Home"
        onClick={() => onNavigate('home')}
        style={{
          width: responsive ? undefined : collapsed ? 44 : '100%',
          alignSelf: 'center',
          height: 44,
          minHeight: 44,
          border: 0,
          background: 'transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: responsive ? undefined : collapsed ? 'center' : 'flex-start',
          padding: responsive ? undefined : collapsed ? 0 : '0 8px',
          cursor: 'pointer',
        }}
      >
        <Logo
          size={28}
          tone="reversed"
          label={null}
          className="dm-sidebar-logo"
          variant={collapsed && !responsive ? 'mark' : 'horizontal'}
        />
      </button>
      <nav
        aria-label="Product navigation"
        className="dm-workspace-nav"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: responsive ? undefined : collapsed ? 12 : 5,
          alignSelf: 'center',
          width: responsive ? undefined : collapsed ? 44 : '100%',
          flex: 1,
          minHeight: 44,
          overflowY: 'auto',
          overflowX: 'hidden',
        }}
      >
        {items.map((item) => {
          const members: readonly LabelKey[] = 'members' in item ? item.members : [item.id];
          const on = members.some((id) => id === active);
          const label = 'label' in item ? item.label : labels[item.id];
          const count = counts[item.id];
          const countText = typeof count === 'object' ? count.text : count;
          const countLabel = typeof count === 'object' ? count.label : undefined;
          const lock = locks[item.id];
          const context = members
            .flatMap((id) => {
              const value = counts[id];
              const description =
                typeof value === 'object'
                  ? value.label
                  : value != null
                    ? `${labels[id]}: ${value}`
                    : null;
              return [description, locks[id] ? `${labels[id]}: ${locks[id]} feature` : null].filter(
                (part): part is string => part !== null,
              );
            })
            .join(' · ');
          const hintLabel = context ? `${label} · ${context}` : label;
          const hasCount = members.some((id) => {
            const value = counts[id];
            const number = typeof value === 'object' ? value.text : value;
            return number != null && number !== 0 && number !== '0';
          });
          const destination = members[0] ?? item.id;
          const signalNavigationIntent = () => {
            if (!on) onNavigateIntent?.(destination);
          };
          return (
            <button
              key={item.id}
              type="button"
              className="dm-nav-row"
              onClick={() => {
                setHint(null);
                onNavigate(destination);
              }}
              onFocus={(event) => {
                signalNavigationIntent();
                showHint(event.currentTarget, hintLabel);
              }}
              onBlur={() => setHint(null)}
              onTouchStart={signalNavigationIntent}
              onMouseEnter={(event) => {
                signalNavigationIntent();
                showHint(event.currentTarget, hintLabel);
              }}
              onMouseLeave={() => setHint(null)}
              aria-current={on ? 'page' : undefined}
              aria-label={grouped ? label : undefined}
              aria-describedby={item.id === 'brief' ? 'nav-catchup-hint' : undefined}
              aria-description={grouped && context ? context : undefined}
              title={grouped ? hintLabel : undefined}
              style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: responsive ? undefined : collapsed ? 'center' : 'flex-start',
                gap: 10,
                height: 44,
                flexShrink: 0,
                padding: responsive ? undefined : collapsed ? 0 : '0 10px',
                borderRadius: 10,
                border: 'none',
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
                cursor: 'pointer',
                textAlign: 'left',
                transition: `background ${motion.fast} ${motion.ease}`,
              }}
            >
              <NavIcon d={item.icon} />
              {labelled && (
                <span className="dm-sidebar-label" style={{ flex: 1, minWidth: 0 }}>
                  {label}
                </span>
              )}
              {!grouped && lock && (
                <span
                  className="dm-nav-lock"
                  aria-label={`${lock} feature`}
                  style={{ fontSize: text.xs }}
                >
                  {lock}
                </span>
              )}
              {!grouped && countText != null && (
                <span
                  aria-label={countLabel}
                  style={{ fontSize: text.sm, fontVariantNumeric: 'tabular-nums' }}
                >
                  {countText}
                </span>
              )}
              {grouped && hasCount && (
                <span
                  aria-hidden="true"
                  data-testid={`nav-dot-${item.id}`}
                  style={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    width: 5,
                    height: 5,
                    borderRadius: radius.pill,
                    background: 'var(--dm-nav-marker)',
                  }}
                />
              )}
            </button>
          );
        })}
        <p id="nav-catchup-hint" hidden>
          {WS2_COPY.explain.catchup.replaceAll('{BRIEF_NAME}', BRIEF_NAME)}
        </p>
      </nav>
      <nav className="dm-sidebar-account" aria-label="Account navigation">
        <span className="dm-sidebar-account-heading" hidden={!labelled}>
          Account
        </span>
        {[
          {
            id: 'settings',
            label: 'Settings',
            icon: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
          },
          { id: 'billing', label: BILLING_NAME, icon: 'M3 5h18v14H3V5Zm0 5h18M7 15h3' },
        ].map((item) => {
          const on = active === item.id || active.startsWith(`${item.id}/`);
          const destinationProps = {
            className: 'dm-nav-row dm-rail-account',
            'aria-label': item.label,
            'aria-current': on ? ('page' as const) : undefined,
            title: item.label,
            onMouseEnter: (event: React.MouseEvent<HTMLElement>) => {
              onNavigateIntent?.(item.id);
              showHint(event.currentTarget, item.label);
            },
            onMouseLeave: () => setHint(null),
            onFocus: (event: React.FocusEvent<HTMLElement>) => {
              onNavigateIntent?.(item.id);
              showHint(event.currentTarget, item.label);
            },
            onBlur: () => setHint(null),
          };
          const content = (
            <>
              <NavIcon d={item.icon} />
              {labelled && <span className="dm-sidebar-label">{item.label}</span>}
            </>
          );
          const navigate = () => {
            setHint(null);
            onNavigate(item.id);
          };
          return hrefFor ? (
            <a
              key={item.id}
              {...destinationProps}
              href={hrefFor(item.id)}
              onClick={(event) => {
                if (
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                )
                  return;
                event.preventDefault();
                navigate();
              }}
            >
              {content}
            </a>
          ) : (
            <button key={item.id} {...destinationProps} type="button" onClick={navigate}>
              {content}
            </button>
          );
        })}
      </nav>
      {hint && grouped && (
        <span aria-hidden="true" className="dm-nav-hint" style={{ top: hint.top, left: hint.left }}>
          {hint.label}
        </span>
      )}
    </aside>
  );
}

/** Real feature routes inside the five approved workspace groups. */
export function SectionNavigation({
  active,
  onNavigate,
  onNavigateIntent,
  counts = {},
  locks = {},
}: {
  active: string;
  onNavigate: (id: string) => void;
  onNavigateIntent?: ((id: string) => void) | undefined;
  counts?: Partial<Record<string, NavCount>>;
  locks?: Partial<Record<string, string>>;
}) {
  const labels = useLabels();
  const section = workspaceSection(active);
  if (!section || section.members.length < 2) return null;
  return (
    <nav className="dm-section-navigation" aria-label={`${section.label} views`}>
      {section.members.map((id) => {
        const count = counts[id];
        const countText = typeof count === 'object' ? count.text : count;
        const countLabel = typeof count === 'object' ? count.label : undefined;
        const lock = locks[id];
        const on = active === id;
        const intent = () => {
          if (!on) onNavigateIntent?.(id);
        };
        return (
          <button
            key={id}
            type="button"
            onClick={() => onNavigate(id)}
            aria-current={on ? 'page' : undefined}
            onMouseEnter={intent}
            onFocus={intent}
            onTouchStart={intent}
          >
            {labels[id]}
            {lock && (
              <span className="dm-section-lock" aria-label={`${lock} feature`}>
                {lock}
              </span>
            )}
            {countText != null && (
              <span className="dm-section-count" aria-label={countLabel}>
                {countText}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
