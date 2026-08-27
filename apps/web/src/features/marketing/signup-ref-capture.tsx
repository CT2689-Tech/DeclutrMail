'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

import { captureSignupRef, readCapturedSignupRef, withSignupRef } from './signup-ref';

/**
 * Marketing-layout island: capture first-touch `ref` and stamp it onto
 * every OAuth start click so SSR hrefs that missed the cookie still
 * carry the value into Google.
 */
export function SignupRefCapture() {
  const pathname = usePathname();

  useEffect(() => {
    captureSignupRef(window.location.pathname, window.location.search);
  }, [pathname]);

  useEffect(() => {
    const decorate = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest('a[href*="/api/auth/google/start"]');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const next = withSignupRef(
        anchor.getAttribute('href') ?? anchor.href,
        readCapturedSignupRef(),
      );
      if (next !== anchor.getAttribute('href')) {
        anchor.setAttribute('href', next);
      }
    };
    document.addEventListener('click', decorate, true);
    return () => document.removeEventListener('click', decorate, true);
  }, []);

  return null;
}
