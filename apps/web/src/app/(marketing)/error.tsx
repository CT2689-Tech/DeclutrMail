'use client';

import Link from 'next/link';
import { useEffect } from 'react';

import { captureErrorBoundaryException } from '@/lib/error-capture';
import { initSentryBrowser } from '@/lib/sentry';

import './marketing-error.css';

const RECOVERY_LINKS = [
  { href: '/', label: 'Home' },
  { href: '/inbox-simulator', label: 'Demo' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/contact', label: 'Contact' },
] as const;

/**
 * Route-local recovery for every public page.
 *
 * This boundary sits below the marketing layout, so the public header,
 * footer, light theme, and consent controls remain available when a page
 * fails. Error messages and digests are intentionally never rendered.
 */
export default function MarketingError({
  error,
  reset,
}: {
  error: Error & { digest?: string | undefined };
  reset: () => void;
}) {
  useEffect(() => {
    void (async () => {
      await initSentryBrowser();
      await captureErrorBoundaryException(error, {
        boundary: 'app-router-error',
        digest: error.digest,
      });
    })();
  }, [error]);

  return (
    <section className="dm-public-error" aria-labelledby="public-error-title">
      <div className="dm-public-error-card">
        <div className="dm-public-error-message" role="alert" aria-atomic="true">
          <span className="dm-public-error-eyebrow">Page paused</span>
          <h1 id="public-error-title">This page didn&rsquo;t finish loading.</h1>
          <p>Retry now, or use one of these public pages to keep exploring DeclutrMail.</p>
        </div>

        <div className="dm-public-error-actions" role="group" aria-label="Page recovery options">
          <button type="button" className="dm-public-error-retry" onClick={reset}>
            Retry
          </button>
          {RECOVERY_LINKS.map((link) => (
            <Link key={link.href} className="dm-public-error-link" href={link.href}>
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
