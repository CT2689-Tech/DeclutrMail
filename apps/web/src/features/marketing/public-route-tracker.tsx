'use client';

import { usePathname } from 'next/navigation';

import type { EventProps } from '@declutrmail/shared/observability';

import { useConsentedPageView } from './use-consented-page-view';

type PublicPage = EventProps<'page_viewed'>['page'];

/**
 * New public routes that do not already own a more specific page-view
 * emitter. Article slugs intentionally collapse into content families so
 * PostHog cardinality stays bounded; route-level SEO reporting belongs in
 * the web analytics layer, not in event names.
 */
export function publicPageForPath(pathname: string | null): PublicPage | null {
  // `usePathname` may be null while a compatibility router initializes and in
  // isolated layout tests. No path means there is nothing honest to emit yet.
  if (!pathname) return null;
  if (pathname === '/') return 'landing';
  if (pathname === '/how-it-works') return 'how_it_works';
  if (pathname === '/methodology') return 'methodology';
  if (pathname === '/compare') return 'compare';
  if (pathname.startsWith('/vs/')) return 'comparison';
  if (pathname.startsWith('/how-to/')) return 'how_to';
  if (pathname.startsWith('/answers/')) return 'answer';
  if (pathname === '/blog' || pathname.startsWith('/blog/')) return 'blog';
  if (pathname === '/changelog') return 'changelog';
  if (pathname === '/faq') return 'faq';
  if (pathname === '/sign-in') return 'sign_in';
  return null;
}

export function PublicRouteTracker() {
  const pathname = usePathname();
  useConsentedPageView(publicPageForPath(pathname));

  return null;
}
