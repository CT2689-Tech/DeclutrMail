'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { PRIVACY_STORAGE_ITEMS } from '../copy/privacy';
import { color, font } from '../tokens/tokens';
import { useFocusTrap } from '../hooks/use-focus-trap';
import { UNDO_TRAY_INSET_VAR } from '../components/undo-tray/undo-tray';
import { UNIFORM_UNDO_WINDOW_DAYS } from '../entitlements';
import { Sidebar } from './sidebar';

export const TRUST_CLAIMS = [
  // D227 K/A/U/L/D — Delete IS a verb. The prior "Nothing deleted"
  // claim was a flat lie once ADR-0019 landed Delete. Per CLAUDE.md
  // §2.1, the canonical claim is the storage allowlist, not the
  // mutation surface. Archive/Later/Delete share the plan Activity Undo
  // window; Delete also has Gmail's separate Trash-retention fallback.
  // The sentence below has TWO "30 days": the Activity window (ours —
  // derived from UNIFORM_UNDO_WINDOW_DAYS) and Gmail's Trash retention
  // (Google's, not ours — stays a literal; do not derive it).
  {
    label: 'Undo windows',
    destination: 'activity',
    title:
      UNIFORM_UNDO_WINDOW_DAYS === null
        ? "Archive, Later, and Delete use your plan's Activity Undo window. Gmail Trash recovery is separate and normally lasts up to 30 days. Delivered unsubscribe requests can't be recalled."
        : `Archive, Later, and Delete can be undone from Activity for ${UNIFORM_UNDO_WINDOW_DAYS} days. Gmail Trash recovery is separate and normally lasts up to 30 days. Delivered unsubscribe requests can't be recalled.`,
  },
  {
    label: 'Stored Gmail data',
    destination: 'settings',
    title: `Stored message data: ${PRIVACY_STORAGE_ITEMS.join(', ')}. Full message bodies and attachments are never fetched.`,
  },
] as const;

/**
 * App chrome: sidebar + a topbar trust strip + a scrollable content
 * area. Responsive behaviour is **CSS-driven** (`tokens.css` media
 * queries on `dm-sidebar-desktop` / `dm-topbar-hamburger` /
 * `dm-trust-extra`) so the layout is correct at first paint — a JS
 * breakpoint hook would flash the desktop shell on mobile before
 * hydration. Below `sm` the sidebar hides and a hamburger opens it as
 * a drawer. Routing-agnostic — the host supplies `active`/`onNavigate`.
 */
export function AppShell({
  active,
  onNavigate,
  onNavigateIntent,
  counts,
  topbarRight,
  children,
}: {
  active: string;
  onNavigate: (id: string) => void;
  /** Early signal used by framework hosts to prefetch nav destinations. */
  onNavigateIntent?: ((id: string) => void) | undefined;
  /** Per-item badge slot — see `Sidebar`'s `counts` doc. */
  counts?: Partial<Record<string, string | number | ReactNode>>;
  /**
   * Optional slot rendered at the right edge of the topbar. The web
   * app uses this for the account menu (switch mailbox, disconnect,
   * sign out). Shared has no API access so it does not own the menu
   * implementation.
   */
  topbarRight?: ReactNode;
  children: ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useFocusTrap<HTMLDivElement>(drawerOpen);

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
              background: 'rgba(14,20,19,0.34)',
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
                // Sits on the scrim, clear of the 220px rail, rather
                // than on top of it: the rail's top row is the brand
                // lockup, and a button pinned inside `right: 12` lands
                // on the tail of the wordmark (ADR-0036).
                position: 'absolute',
                top: 12,
                left: 232,
                zIndex: 1,
                width: 44,
                height: 44,
                border: `1px solid ${color.border}`,
                borderRadius: 8,
                background: color.card,
                color: color.fg,
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
        {/* Topbar — hamburger (mobile only) + trust strip. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 14px',
            borderBottom: `1px solid ${color.border}`,
            background: color.card,
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
              // NO `display` here — it lives in tokens.css, same rule as
              // the trust strip below. An inline `display: inline-flex`
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
          <div
            // `display` lives in tokens.css, not here: an inline style
            // would outrank the phone-width media query that drops the
            // strip (same reason `dm-trust-extra` sets none inline).
            className="dm-trust-strip"
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              fontFamily: font.mono,
              fontSize: 9.5,
              textTransform: 'uppercase',
              letterSpacing: '0.14em',
              color: color.fgMuted,
              overflow: 'hidden',
            }}
          >
            {TRUST_CLAIMS.map((claim, i) => (
              <span
                key={claim.label}
                className={i > 0 ? 'dm-trust-extra' : undefined}
                style={
                  i > 0
                    ? { alignItems: 'center', gap: 12 }
                    : { display: 'inline-flex', alignItems: 'center', gap: 12 }
                }
              >
                {i > 0 && <span style={{ opacity: 0.35 }}>·</span>}
                <button
                  type="button"
                  onClick={() => onNavigate(claim.destination)}
                  title={claim.title}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = color.primary;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = 'inherit';
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: 0,
                    background: 'transparent',
                    border: 'none',
                    font: 'inherit',
                    letterSpacing: 'inherit',
                    color: 'inherit',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {i === 0 && (
                    <span
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: 9999,
                        background: color.emerald,
                      }}
                    />
                  )}
                  {claim.label}
                </button>
              </span>
            ))}
          </div>
          {topbarRight ? (
            <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
              {topbarRight}
            </div>
          ) : null}
        </div>

        <div
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
            // tray is mounted.
            paddingBottom: `var(${UNDO_TRAY_INSET_VAR}, 0px)`,
          }}
        >
          {children}
        </div>
      </main>
    </div>
  );
}
