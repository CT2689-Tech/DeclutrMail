'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

import { ThemeToggle } from '@/features/theme/theme-toggle';

import { TrackedCta } from '../landing/tracked-cta';
import { PublicNavLinks } from './public-nav-links';
import { useSessionHint } from './use-session-hint';

export function PublicMobileMenu({
  links,
  startUrl,
  showTheme = false,
  openLabel,
  closeLabel,
}: {
  links: ReadonlyArray<{ href: string; label: string }>;
  startUrl: string;
  showTheme?: boolean;
  /** `ws3.nav.menu.aria`. Passed in so this client chunk does not import the copy module. */
  openLabel: string;
  closeLabel: string;
}) {
  const pathname = usePathname();
  const signedIn = useSessionHint();
  const onSignIn = pathname === '/sign-in';
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  // Route groups preserve this layout during client navigation. Close the
  // sheet so the next page does not inherit an open menu.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    document.body.classList.add('dm-public-menu-open');
    const header = document.querySelector('.dm-public-header');
    const syncOffset = () => {
      if (!(header instanceof HTMLElement)) return;
      document.documentElement.style.setProperty(
        '--dm-public-header-offset',
        `${header.getBoundingClientRect().height}px`,
      );
    };
    syncOffset();
    window.addEventListener('resize', syncOffset);
    return () => {
      document.body.classList.remove('dm-public-menu-open');
      document.documentElement.style.removeProperty('--dm-public-header-offset');
      window.removeEventListener('resize', syncOffset);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const root = menuRef.current;
      if (!root) return;
      const focusable = [...root.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !root.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="dm-public-menu-cluster">
      {!signedIn && !onSignIn ? (
        <TrackedCta
          className="dm-public-start dm-public-mobile-cta"
          href={startUrl}
          cta="connect_gmail"
          placement="nav"
        >
          Start free
        </TrackedCta>
      ) : null}
      <div
        ref={menuRef}
        className="dm-public-menu"
        data-open={open ? 'true' : 'false'}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || !open) return;
          event.preventDefault();
          close();
          buttonRef.current?.focus();
        }}
      >
        <button
          ref={buttonRef}
          type="button"
          className="dm-public-menu-button"
          aria-label={open ? closeLabel : openLabel}
          aria-expanded={open}
          aria-controls={open ? 'dm-public-mobile-nav' : undefined}
          onClick={() => setOpen((value) => !value)}
        >
          Menu
        </button>
        {open ? (
          <nav id="dm-public-mobile-nav" aria-label="Mobile navigation">
            <PublicNavLinks links={links} onNavigate={close} />
            {showTheme ? <ThemeToggle className="dm-public-menu-theme" /> : null}
            {signedIn ? (
              <TrackedCta
                className="dm-public-menu-start"
                href="/home"
                cta="open_app"
                placement="nav"
                onClick={close}
              >
                Open DeclutrMail
              </TrackedCta>
            ) : (
              <>
                <TrackedCta
                  className="dm-public-menu-sign-in"
                  href="/sign-in?returning=1"
                  cta="connect_gmail"
                  placement="nav_sign_in"
                  onClick={close}
                >
                  Sign in
                </TrackedCta>
                {onSignIn ? null : (
                  <TrackedCta
                    className="dm-public-menu-start"
                    href={startUrl}
                    cta="connect_gmail"
                    placement="nav"
                    onClick={close}
                  >
                    Start free
                  </TrackedCta>
                )}
              </>
            )}
          </nav>
        ) : null}
      </div>
    </div>
  );
}
