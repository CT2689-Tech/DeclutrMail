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

// Every real destination remains available in section navigation and the
// complete mobile menu. The desktop rail uses the approved five groups.
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

export const WORKSPACE_NAV = [
  { id: 'home', label: 'Overview', icon: 'm3 10 9-7 9 7v10H3V10Zm6 10v-7h6v7', members: ['home'] },
  {
    id: 'senders',
    label: 'Clean up',
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
    members: ['brief', 'followups', 'snoozed'],
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
  accountInitial,
}: {
  active: string;
  onNavigate: (id: string) => void;
  onNavigateIntent?: ((id: string) => void) | undefined;
  counts?: Partial<Record<string, NavCount>>;
  locks?: Partial<Record<string, string>>;
  /** Compact five-section rail; false renders the complete mobile menu. */
  collapsed?: boolean;
  accountInitial?: string | undefined;
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
  const items = collapsed ? WORKSPACE_NAV : NAV;
  return (
    <aside
      className="dm-editorial-sidebar"
      aria-label="Workspace navigation"
      onScroll={() => setHint(null)}
      data-collapsed={collapsed ? 'true' : 'false'}
      style={{
        width: collapsed ? SIDEBAR_RAIL_WIDTH : SIDEBAR_WIDTH,
        flexShrink: 0,
        height: '100%',
        boxSizing: 'border-box',
        overflowX: 'hidden',
        overflowY: 'auto',
        background: 'var(--dm-nav-bg)',
        padding: '22px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 32,
        fontFamily: font.sans,
      }}
    >
      <button
        type="button"
        className="dm-rail-brand"
        aria-label="DeclutrMail overview"
        onClick={() => onNavigate('home')}
        style={{
          width: collapsed ? 44 : '100%',
          alignSelf: 'center',
          height: 44,
          minHeight: 44,
          border: 0,
          background: 'transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-start',
          padding: collapsed ? 0 : '0 8px',
          cursor: 'pointer',
        }}
      >
        <Logo size={28} tone="reversed" variant={collapsed ? 'mark' : 'horizontal'} />
      </button>
      <nav
        aria-label="Product navigation"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: collapsed ? 12 : 5,
          alignSelf: 'center',
          width: collapsed ? 44 : '100%',
          flex: 1,
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
          const signalNavigationIntent = () => {
            if (!on) onNavigateIntent?.(item.id);
          };
          return (
            <button
              key={item.id}
              type="button"
              className="dm-nav-row"
              onClick={() => {
                setHint(null);
                onNavigate(item.id);
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
              aria-label={collapsed ? label : undefined}
              aria-description={collapsed && context ? context : undefined}
              title={collapsed ? hintLabel : undefined}
              style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: collapsed ? 'center' : 'flex-start',
                gap: 10,
                height: 44,
                flexShrink: 0,
                padding: collapsed ? 0 : '0 10px',
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
              {!collapsed && <span style={{ flex: 1, minWidth: 0 }}>{label}</span>}
              {!collapsed && lock && (
                <span
                  className="dm-nav-lock"
                  aria-label={`${lock} feature`}
                  style={{ fontSize: text.xs }}
                >
                  {lock}
                </span>
              )}
              {!collapsed && countText != null && (
                <span
                  aria-label={countLabel}
                  style={{ fontSize: text.sm, fontVariantNumeric: 'tabular-nums' }}
                >
                  {countText}
                </span>
              )}
              {collapsed && hasCount && (
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
      </nav>
      <button
        type="button"
        className="dm-rail-account"
        aria-label="Workspace settings"
        aria-current={active === 'settings' ? 'page' : undefined}
        title="Workspace settings"
        onClick={() => {
          setHint(null);
          onNavigate('settings');
        }}
        onMouseEnter={(event) => showHint(event.currentTarget, 'Workspace settings')}
        onMouseLeave={() => setHint(null)}
        onFocus={(event) => showHint(event.currentTarget, 'Workspace settings')}
        onBlur={() => setHint(null)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          width: collapsed ? 44 : '100%',
          height: 44,
          alignSelf: 'center',
          minHeight: 44,
          marginTop: 'auto',
          background: '#ffffff10',
          border: 0,
          borderRadius: 10,
          color: 'var(--dm-nav-fg)',
          fontSize: 12,
          cursor: 'pointer',
        }}
      >
        {accountInitial ?? (
          <NavIcon d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" />
        )}
        {!collapsed && <span>Settings</span>}
      </button>
      {hint && collapsed && (
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
