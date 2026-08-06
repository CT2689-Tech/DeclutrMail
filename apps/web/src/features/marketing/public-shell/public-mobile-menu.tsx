'use client';

import { useEffect, useRef } from 'react';
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
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const close = () => detailsRef.current?.removeAttribute('open');

  // Route groups preserve this layout during client navigation. Close the
  // disclosure so the next page does not inherit an open menu.
  useEffect(() => {
    detailsRef.current?.removeAttribute('open');
  }, [pathname]);

  return (
    <details
      ref={detailsRef}
      className="dm-public-menu"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !detailsRef.current?.open) return;
        event.preventDefault();
        detailsRef.current.open = false;
        detailsRef.current.querySelector('summary')?.focus();
      }}
    >
      <summary aria-label="Open navigation">Menu</summary>
      <nav aria-label="Mobile navigation">
        <PublicNavLinks links={links} onNavigate={close} />
        <TrackedCta href={startUrl} cta="connect_gmail" placement="nav_sign_in" onClick={close}>
          Sign in
        </TrackedCta>
        <TrackedCta
          className="dm-public-menu-start"
          href={startUrl}
          cta="connect_gmail"
          placement="nav"
          onClick={close}
        >
          Get started →
        </TrackedCta>
      </nav>
    </details>
  );
}
