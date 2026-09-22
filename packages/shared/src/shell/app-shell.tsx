'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { breakpoint, color, font, motion, radius, shadow, text } from '../tokens/tokens';
import { useFocusTrap } from '../hooks/use-focus-trap';
import { useLabels, type LabelKey } from '../hooks/use-labels';
import { UNDO_TRAY_INSET_VAR } from '../components/undo-tray/undo-tray';
import { HelpButton } from './help-button';
import {
  WORKSPACE_NAV,
  workspaceSection,
  SectionNavigation,
  NavIcon,
  Sidebar,
  SIDEBAR_WIDTH,
  type NavCount,
} from './sidebar';

/**
 * App chrome: sidebar + a quiet top bar + a scrollable content area.
 * Responsive behaviour is **CSS-driven** (`tokens.css` media queries on
 * `dm-sidebar-desktop` / `dm-topbar-hamburger` / `dm-tabbar`) so the
 * layout is correct at first paint — a JS breakpoint hook would flash
 * the desktop shell on mobile before hydration. At 760px and below the sidebar
 * becomes a horizontal row carrying the same five workspace groups.
 * Section navigation and the hamburger drawer expose every feature route.
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
  accountInitial,
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
  accountInitial?: string | undefined;
  children: ReactNode;
}) {
  const labels = useLabels();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useFocusTrap<HTMLDivElement>(drawerOpen);

  // The top bar is borderless at rest; a hairline appears only once
  // content has scrolled under it.
  const [scrolled, setScrolled] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Next resets the document on navigation, but this shell owns a nested
  // scroller. Preserve position for query-only sender changes; start a new
  // screen at its heading instead of carrying over the previous page's scroll.
  useEffect(() => {
    if (routeKey === undefined) return;
    if (contentRef.current) contentRef.current.scrollTop = 0;
    setScrolled(false);
  }, [routeKey]);

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
  // no idea the breakpoint moved: open the drawer on mobile, then widen
  // or rotate past 760px, and the hamburger disappears while the dialog
  // stays mounted — a second <Sidebar> in an aria-modal dialog pinned
  // over the now-visible desktop one, focus trap and duplicate nav
  // landmarks included. That is precisely the state the inline-`display`
  // fix removed, reachable by a different door. The listener is the
  // narrow exception to "no JS breakpoints": it never decides layout,
  // it only retires a state the layout can no longer host.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const desktop = window.matchMedia(`(min-width: ${breakpoint.shell + 1}px)`);
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
      {/* Desktop sidebar — CSS-hidden at 760px and below. */}
      <div className="dm-sidebar-desktop" style={{ flexShrink: 0 }}>
        <Sidebar
          active={active}
          onNavigate={onNavigate}
          onNavigateIntent={onNavigateIntent}
          counts={counts ?? {}}
          locks={locks ?? {}}
          collapsed
          accountInitial={accountInitial}
        />
      </div>

      {/* Mobile drawer + scrim — the hamburger is CSS-hidden on desktop,
          so `drawerOpen` can only become true on a small screen. */}
      {drawerOpen && (
        <>
          <div
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
            className="dm-scrim"
            style={{ position: 'fixed', inset: 0, zIndex: 80 }}
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
                borderRadius: radius.pill,
                background: color.card,
                boxShadow: shadow.card,
                color: color.fg,
                fontSize: text.xl,
                lineHeight: 1,
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
              accountInitial={accountInitial}
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
        {/* Mobile workspace groups — above the top bar in DOM and visual order,
            matching the prototype. In flow, never over the content. */}
        <nav
          className="dm-tabbar"
          aria-label="Primary"
          style={{
            flexShrink: 0,
            alignItems: 'stretch',
            order: -1,
            gap: 2,
            padding: '10px 8px',
            background: 'var(--dm-nav-bg)',
          }}
        >
          {WORKSPACE_NAV.map((item) => {
            const { id } = item;
            const on = workspaceSection(active)?.id === id;
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
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Top bar — hamburger (mobile only), then help + the host's
            controls on the right. Deliberately quiet: no fill, and a
            hairline only while content is scrolled beneath it. */}
        <div
          data-scrolled={scrolled ? 'true' : 'false'}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            minHeight: 56,
            padding: '0 16px',
            borderBottom: `1px solid ${scrolled ? color.lineSoft : 'transparent'}`,
            background: 'transparent',
            flexShrink: 0,
            transition: `border-color ${motion.fast} ${motion.ease}`,
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
              // ≤760px media query that re-enables it, so the button
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
          <div className="dm-shell-location" style={{ flex: 1 }}>
            <span>YOUR WORKSPACE /</span>
            <strong>
              {workspaceSection(active)?.label ?? labels[active as LabelKey] ?? active}
            </strong>
          </div>
          <HelpButton />
          {topbarRight ? (
            <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
              {topbarRight}
            </div>
          ) : null}
        </div>

        <SectionNavigation
          active={active}
          onNavigate={onNavigate}
          onNavigateIntent={onNavigateIntent}
          counts={counts ?? {}}
          locks={locks ?? {}}
        />

        <div
          // `dm-main-scroll` centres each screen's column and carries the
          // route fade (tokens.css). It must stay `display: block`.
          className="dm-main-scroll"
          ref={contentRef}
          data-route-flip={routeFlip}
          onScroll={(event) => {
            const next = event.currentTarget.scrollTop > 0;
            if (next !== scrolled) setScrolled(next);
          }}
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
            // with no bottom navigation inset in the editorial shell.
            paddingBottom: `max(0px, calc(var(${UNDO_TRAY_INSET_VAR}, 0px) - var(--dm-tabbar-inset, 0px)))`,
          }}
        >
          {children}
        </div>
      </main>
    </div>
  );
}

function tabStyle(on: boolean) {
  return {
    flex: 1,
    minWidth: 44,
    height: 52,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    padding: 0,
    border: 'none',
    borderRadius: 10,
    background: on ? 'var(--dm-nav-active)' : 'transparent',
    boxShadow: on ? 'inset 0 -3px var(--dm-nav-marker)' : undefined,
    color: on ? 'var(--dm-nav-fg)' : 'var(--dm-nav-muted)',
    fontFamily: font.sans,
    fontSize: text.xs,
    fontWeight: on ? 600 : 500,
    cursor: 'pointer',
    transition: `color ${motion.fast} ${motion.ease}`,
  };
}
