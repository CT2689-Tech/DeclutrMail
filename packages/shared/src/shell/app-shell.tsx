'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { color, font } from '../tokens/tokens';
import { useFocusTrap } from '../hooks/use-focus-trap';
import { Sidebar } from './sidebar';

const TRUST_CLAIMS = [
  // D227 K/A/U/L/D — Delete IS a verb. The prior "Nothing deleted"
  // claim was a flat lie once ADR-0019 landed Delete. Per CLAUDE.md
  // §2.1, the canonical claim is the storage allowlist, not the
  // mutation surface. "Recoverable" covers both Archive/Later (7d
  // Activity undo) and Delete (30d Gmail Trash retention).
  {
    label: 'Recovery',
    title:
      "Archive and Later use your plan's Activity window. Delete can be undone while Gmail retains Trash, up to 30 days. A delivered unsubscribe request is one-way.",
  },
  {
    label: 'Metadata only',
    title:
      'We act on labels and message states. Stored: sender, subject, snippet, dates, labels — never message bodies or attachments.',
  },
];

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
  counts,
  topbarRight,
  children,
}: {
  active: string;
  onNavigate: (id: string) => void;
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
        // consumer ((app)/layout.tsx) always provides a 100vh parent.
        height: '100%',
        background: 'transparent',
        color: color.fg,
        fontFamily: font.sans,
        overflow: 'hidden',
      }}
    >
      {/* Desktop sidebar — CSS-hidden below the `sm` breakpoint. */}
      <div className="dm-sidebar-desktop" style={{ flexShrink: 0 }}>
        <Sidebar active={active} onNavigate={onNavigate} counts={counts ?? {}} />
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
                position: 'absolute',
                top: 12,
                right: 12,
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
            <Sidebar active={active} onNavigate={navigate} counts={counts ?? {}} />
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
              display: 'inline-flex',
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
            style={{
              flex: 1,
              display: 'flex',
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
                  onClick={() => onNavigate(claim.label === 'Recovery' ? 'activity' : 'settings')}
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

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
          {children}
        </div>
      </main>
    </div>
  );
}
