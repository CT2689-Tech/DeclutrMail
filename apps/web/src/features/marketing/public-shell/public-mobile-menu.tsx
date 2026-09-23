'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

import { TrackedCta } from '../landing/tracked-cta';
import { PublicNavLinks } from './public-nav-links';

export function PublicMobileMenu({
  links,
  startUrl,
}: {
  links: ReadonlyArray<{ href: string; label: string }>;
  startUrl: string;
}) {
  const pathname = usePathname();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  // Route groups preserve this layout during client navigation. Close the
  // sheet so the next page does not inherit an open menu.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div
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
        aria-label={open ? 'Close navigation' : 'Open navigation'}
        aria-expanded={open}
        aria-controls={open ? 'dm-public-mobile-nav' : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        Menu
      </button>
      {open ? (
        <nav id="dm-public-mobile-nav" aria-label="Mobile navigation">
          <PublicNavLinks links={links} onNavigate={close} />
          <TrackedCta
            className="dm-public-menu-sign-in"
            href={startUrl}
            cta="connect_gmail"
            placement="nav_sign_in"
            onClick={close}
          >
            Sign in
          </TrackedCta>
          <TrackedCta
            className="dm-public-menu-start"
            href={startUrl}
            cta="connect_gmail"
            placement="nav"
            onClick={close}
          >
            Start free
          </TrackedCta>
        </nav>
      ) : null}
    </div>
  );
}
