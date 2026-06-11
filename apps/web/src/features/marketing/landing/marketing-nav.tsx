'use client';

import { useEffect, useState } from 'react';

import { track } from '@/lib/posthog';
import { oauthStartUrl } from './urls';
import { TrackedCta } from './tracked-cta';

/**
 * Landing masthead (D134 §2 routing).
 *
 * Session handling is a non-blocking probe: the nav renders the
 * logged-out state IMMEDIATELY (no auth round-trip gates first paint),
 * then a background `GET /api/auth/me` flips the CTA to "Open app"
 * for an authed visitor. Deliberately a bare `fetch`, not the api
 * client: the client's 401-refresh-rotation retry would cost every
 * anonymous visitor an extra POST, and a 401 here is the expected
 * steady state, not an error.
 */
export function MarketingNav() {
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';
    fetch(`${apiBase}/api/auth/me`, { credentials: 'include', signal: ctrl.signal })
      .then((res) => {
        setAuthed(res.ok);
      })
      .catch(() => {
        // Network failure / abort ⇒ logged-out presentation (the default).
        setAuthed(false);
      });
    return () => ctrl.abort();
  }, []);

  // D159 funnel: one page_viewed per landing mount. Lives here (the
  // single always-mounted client island) so the server-rendered page
  // body stays JS-free.
  useEffect(() => {
    void track('page_viewed', { page: 'landing', mailbox_id: null });
  }, []);

  return (
    <header className="dm-mkt-masthead">
      <div className="dm-mkt-shell">
        <div className="dm-mkt-masthead-row">
          <a href="/" className="dm-mkt-wordmark">
            DeclutrMail<b>.</b>
          </a>
          <nav className="dm-mkt-nav-links" aria-label="Site">
            <a href="#how-it-works" className="dm-mkt-nav-link">
              How it works
            </a>
            <a href="#privacy" className="dm-mkt-nav-link">
              Privacy
            </a>
            <a href="/pricing" className="dm-mkt-nav-link">
              Pricing
            </a>
            {authed ? (
              <TrackedCta href="/senders" cta="open_app" placement="nav" className="dm-mkt-nav-cta">
                Open app →
              </TrackedCta>
            ) : (
              <TrackedCta
                href={oauthStartUrl()}
                cta="connect_gmail"
                placement="nav"
                className="dm-mkt-nav-cta"
              >
                Connect your Gmail
              </TrackedCta>
            )}
          </nav>
        </div>
      </div>
    </header>
  );
}
