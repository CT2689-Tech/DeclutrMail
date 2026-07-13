'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type PublicNavLink = { href: string; label: string };

export function PublicNavLinks({
  links,
  onNavigate,
}: {
  links: ReadonlyArray<PublicNavLink>;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return links.map((link) => (
    <Link
      key={link.href}
      href={link.href}
      aria-current={isPublicNavLinkActive(pathname, link.href) ? 'page' : undefined}
      {...(onNavigate ? { onClick: onNavigate } : {})}
    >
      {link.label}
    </Link>
  ));
}

/** Keep public aliases/detail routes attached to their stable top-level tab. */
export function isPublicNavLinkActive(pathname: string, href: string): boolean {
  if (href === '/inbox-simulator') {
    return pathname === href || pathname === '/demo';
  }
  if (href === '/compare') {
    return pathname === href || pathname.startsWith('/vs/');
  }
  return pathname === href;
}
