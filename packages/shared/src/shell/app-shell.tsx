'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { color, font, motion, radius, text } from '../tokens/tokens';
import { useFocusTrap } from '../hooks/use-focus-trap';
import { useLabels, type LabelKey } from '../hooks/use-labels';
import { useLocalState } from '../hooks/use-local-state';
import { UNDO_TRAY_INSET_VAR } from '../components/undo-tray/undo-tray';
import { HelpButton } from './help-button';
import { NAV, NavIcon, Sidebar, SIDEBAR_WIDTH, type NavCount } from './sidebar';

/** The mobile tab bar's destinations; everything else is behind "More". */
const TAB_IDS: readonly LabelKey[] = ['home', 'senders', 'triage', 'activity'];
const MORE_ICON = 'M5 12h.01M12 12h.01M19 12h.01';

/**
 * App chrome: sidebar + a quiet top bar + a scrollable content area.
 * Responsive behaviour is **CSS-driven** (`tokens.css` media queries on
 * `dm-sidebar-desktop` / `dm-topbar-hamburger` / `dm-tabbar`) so the
 * layout is correct at first paint — a JS breakpoint hook would flash
 * the desktop shell on mobile before hydration. Below `sm` the sidebar
 * hides; a bottom tab bar carries the four daily destinations and its
 * "More" (like the hamburger) opens the full nav as a drawer.
 * Routing-agnostic — the host supplies `active`/`onNavigate`.
 */
export function AppShell({
  active,
  onNavigate,
  onNavigateIntent,
  counts,
  locks,
  routeKey,
  topbarRight,
  children,
}: {
  active: string;
  onNavigate: (id: string) => void;
  /** Early signal used by framework hosts to prefetch nav destinations. */
  onNavigateIntent?: ((id: string) => void) | undefined;
  /** Per-item count — see `Sidebar`'s `counts` doc. */
  counts?: Partial<Record<string, NavCount>>;
  /** Per-item lock marker — see `Sidebar`'s `locks` doc. */
  locks?: Partial<Record<string, string>>;
  /**
   * Changes whenever the route does (the host passes its pathname).
   * Drives the content fade; without it the shell never animates.
   */
  routeKey?: string | undefined;
  /**
   * Optional slot rendered at the right edge of the topbar. The web
   * app uses this for the account menu (switch mailbox, disconnect,
   * sign out). Shared has no API access so it does not own the menu
   * implementation.
   */
  topbarRight?: ReactNode;
  children: ReactNode;
}) {
  const labels = useLabels();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useFocusTrap<HTMLDivElement>(drawerOpen);

  // Per-device choice. `useLocalState` reads storage after mount, so the
  // server and first client render agree on the expanded default.
  const [collapsed, setCollapsed] = useLocalState<boolean>('sidebar.collapsed', false);
  const [animateWidth, setAnimateWidth] = useState(false);

  // Route fade. Flips between two identical keyframes on navigation
  // (see tokens.css) — adjusting state during render is React's
  // documented pattern for deriving from a changed prop. Unset until the
  // first navigation so the initial page load never fades in.
  const [seenRouteKey, setSeenRouteKey] = useState(routeKey);
  const [routeFlip, setRouteFlip] = useState<'a' | 'b' | undefined>(undefined);
  if (seenRouteKey !== routeKey) {
    setSeenRouteKey(routeKey);
    setRouteFlip((flip) => (flip === 'a' ? 'b' : 'a'));
  }

  // Close the drawer whenever the route changes.
  useEffect(() => {
    setDrawerOpen(false);
  }, [active]);

  // Close it when the viewport crosses INTO desktop. Responsive
  // behaviour here is CSS-only by design, which means `drawerOpen` has
  // no idea the breakpoint moved: open the drawer at 800px, then widen
  // or rotate past 900px, and the hamburger disappears while the dialog
  // stays mounted — a second <Sidebar> in an aria-modal dialog pinned
  // over the now-visible desktop one, focus trap and duplicate nav
  // landmarks included. That is precisely the state the inline-`display`
  // fix removed, reachable by a different door. The listener is the
  // narrow exception to "no JS breakpoints": it never decides layout,
  // it only retires a state the layout can no longer host.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const desktop = window.matchMedia('(min-width: 901px)');
    const closeIfDesktop = () => {
      if (desktop.matches) setDrawerOpen(false);
    };
    closeIfDesktop();
    desktop.addEventListener('change', closeIfDesktop);
    return () => desktop.removeEventListener('change', closeIfDesktop);
  }, []);

  useEffect(() => {
    if (!drawerOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setDrawerOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [drawerOpen]);

  const navigate = (id: string) => {
    onNavigate(id);
    setDrawerOpen(false);
  };

  return (
    <div
      style={{
        display: 'flex',
        width: '100%',
        // 100% (not 100vh) — the host layout owns the viewport box so
        // it can stack app-level chrome (the D216 grace-period banner)
        // above the shell without clipping it off the bottom. The only
        // consumer ((app)/layout.tsx) always provides a viewport-height
        // parent (`100dvh` with a `100vh` fallback in tokens.css).
        height: '100%',
        background: 'transparent',
        color: color.fg,
        fontFamily: font.sans,
        overflow: 'hidden',
      }}
    >
      {/* Desktop sidebar — CSS-hidden below the `sm` breakpoint. */}
      <div className="dm-sidebar-desktop" style={{ flexShrink: 0 }}>
        <Sidebar
          active={active}
          onNavigate={onNavigate}
          onNavigateIntent={onNavigateIntent}
          counts={counts ?? {}}
          locks={locks ?? {}}
          collapsed={collapsed}
          animateWidth={animateWidth}
          onToggleCollapsed={() => {
            setAnimateWidth(true);
            setCollapsed((v) => !v);
          }}
        />
      </div>

      {/* Mobile drawer + scrim — the hamburger is CSS-hidden on desktop,
          so `drawerOpen` can only become true on a small screen. */}
      {drawerOpen && (
        <>
          <div
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
            style={{
              position: 'fixed',
              inset: 0,
              background: 'var(--dm-scrim)',
              zIndex: 80,
            }}
          />
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            style={{ position: 'fixed', top: 0, bottom: 0, left: 0, zIndex: 81 }}
          >
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label="Close navigation menu"
              style={{
                // Sits on the scrim, clear of the sidebar, rather than on
                // top of it: the sidebar's top row is the brand lockup,
                // and a button pinned inside `right: 12` lands on the
                // tail of the wordmark (ADR-0036).
                position: 'absolute',
                top: 12,
                left: SIDEBAR_WIDTH + 12,
                zIndex: 1,
                width: 44,
                height: 44,
                border: 'none',
                borderRadius: radius.md,
                background: color.card,
                color: color.fg,
                fontSize: text.xl,
                cursor: 'pointer',
              }}
            >
              ×
            </button>
            <Sidebar
              active={active}
              onNavigate={navigate}
              onNavigateIntent={onNavigateIntent}
              counts={counts ?? {}}
              locks={locks ?? {}}
            />
          </div>
        </>
      )}

      <main
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Top bar — hamburger (mobile only), then help + the host's
            controls on the right. Deliberately quiet: no fill, one
            hairline. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            minHeight: 48,
            padding: '0 16px',
            borderBottom: `1px solid ${color.line}`,
            background: 'transparent',
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            className="dm-topbar-hamburger"
            onClick={(event) => {
              // Establish a deterministic restore target even in
              // browsers/test DOMs that do not focus buttons on click.
              event.currentTarget.focus();
              setDrawerOpen(true);
            }}
            aria-label="Open navigation menu"
            aria-expanded={drawerOpen}
            style={{
              width: 44,
              height: 44,
              padding: 0,
              // NO `display` here — it lives in tokens.css. An inline
              // `display: inline-flex`
              // outranks `.dm-topbar-hamburger { display: none }` and the
              // ≤900px media query that re-enables it, so the button
              // rendered at EVERY width. On desktop that let a click
              // mount the mobile drawer — a second <Sidebar> in an
              // aria-modal dialog pinned left:0, landing pixel-aligned on
              // top of the always-visible desktop sidebar, with a live
              // focus trap and duplicate nav landmarks. `alignItems` /
              // `justifyContent` stay: they are inert until the class
              // makes the box flex. (Regressed in #325 by a 44px
              // touch-target change that brought `display` along to
              // centre the SVG; live 2026-07-14 → 2026-08-18.)
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: 'none',
              color: color.fg,
              cursor: 'pointer',
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <div style={{ flex: 1 }} />
          <HelpButton />
          {topbarRight ? (
            <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
              {topbarRight}
            </div>
          ) : null}
        </div>

        <div
          // `dm-main-scroll` centres each screen's column and carries the
          // route fade (tokens.css). It must stay `display: block`.
          className="dm-main-scroll"
          data-route-flip={routeFlip}
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
            // Reserve the undo tray's footprint. The tray is fixed to the
            // viewport bottom and mounted OUTSIDE this scroller, so without
            // this it occludes the content's last ~90px — and the content
            // cannot scroll past it, because this container is already at
            // its end. See UNDO_TRAY_INSET_VAR; resolves to 0px whenever no
            // tray is mounted. The tray measures from the VIEWPORT bottom,
            // and on mobile this scroller already ends above the in-flow
            // tab bar — so that much of the reserve is already paid.
            paddingBottom: `max(0px, calc(var(${UNDO_TRAY_INSET_VAR}, 0px) - var(--dm-tabbar-inset, 0px)))`,
          }}
        >
          {children}
        </div>

        {/* Mobile tab bar — CSS-hidden above the `sm` breakpoint. In
            flow (not fixed), so content can never sit underneath it. */}
        <nav
          className="dm-tabbar"
          aria-label="Primary"
          style={{
            flexShrink: 0,
            alignItems: 'stretch',
            height: 56,
            boxSizing: 'content-box',
            paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            borderTop: `1px solid ${color.line}`,
            background: color.paper,
          }}
        >
          {TAB_IDS.map((id) => {
            const on = active === id;
            const item = NAV.find((entry) => entry.id === id)!;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onNavigate(id)}
                onTouchStart={() => {
                  if (!on) onNavigateIntent?.(id);
                }}
                aria-current={on ? 'page' : undefined}
                style={tabStyle(on)}
              >
                <NavIcon d={item.icon} size={20} />
                {labels[id]}
              </button>
            );
          })}
          <button
            type="button"
            onClick={(event) => {
              event.currentTarget.focus();
              setDrawerOpen(true);
            }}
            aria-haspopup="dialog"
            aria-expanded={drawerOpen}
            style={tabStyle(false)}
          >
            <NavIcon d={MORE_ICON} size={20} />
            More
          </button>
        </nav>
      </main>
    </div>
  );
}

function tabStyle(on: boolean) {
  return {
    flex: 1,
    minWidth: 44,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    padding: 0,
    border: 'none',
    background: 'transparent',
    color: on ? color.primary : color.fgMuted,
    fontFamily: font.sans,
    fontSize: text.xs,
    fontWeight: on ? 600 : 400,
    cursor: 'pointer',
    transition: `color ${motion.fast} ${motion.ease}`,
  };
}
