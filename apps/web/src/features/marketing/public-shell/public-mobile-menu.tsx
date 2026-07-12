'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { TrackedCta } from '../landing/tracked-cta';

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
        {links.map((link) => (
          <Link key={link.href} href={link.href} onClick={close}>
            {link.label}
          </Link>
        ))}
        <Link href="/sign-in" onClick={close}>
          Sign in
        </Link>
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
