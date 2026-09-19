'use client';

import { useEffect, useState } from 'react';
import { Analytics, type BeforeSendEvent } from '@vercel/analytics/next';

/** Campaign attribution only. Everything else in a query string is dropped. */
const KEPT_PARAMS = /^(utm_(source|medium|campaign|content|term)|ref)$/;

/**
 * Strip a page-view URL down to its path plus campaign parameters before
 * it leaves the browser. Public pages carry no identifiers in the query
 * today, but `/sign-in` receives redirect and error parameters, and an
 * allowlist stays true when a new parameter is added where a blocklist
 * would silently start shipping it.
 */
export function scrubAnalyticsUrl(raw: string): string {
  const url = new URL(raw);
  for (const key of [...url.searchParams.keys()]) {
    if (!KEPT_PARAMS.test(key)) url.searchParams.delete(key);
  }
  url.hash = '';
  return url.toString();
}

function beforeSend(event: BeforeSendEvent): BeforeSendEvent {
  return { ...event, url: scrubAnalyticsUrl(event.url) };
}

/**
 * Cookieless aggregate page-view counts for the PUBLIC site only
 * (founder decision 2026-09-18). Mounted in the `(marketing)` layout and
 * nowhere else: the authed app never loads it, so no in-product path or
 * Gmail-derived value can reach it.
 *
 * Not consent-gated, unlike PostHog (D147): Vercel Web Analytics sets no
 * cookie and stores nothing on the device. `/privacy` §6 and `/cookies`
 * describe exactly this split — keep them in step with any change here.
 *
 * Public production hosts only, decided by hostname rather than a build
 * env var so the verdict cannot go quietly false. Anywhere else the
 * package either loads a debug script from `va.vercel-scripts.com`, which
 * the public CSP rightly blocks, or requests a `/_vercel/insights` path
 * that does not exist — and preview or localhost traffic is us, which is
 * the noise this exists to avoid.
 */
export function isCountedHost(hostname: string): boolean {
  return hostname === 'declutrmail.com' || hostname === 'www.declutrmail.com';
}

export function SiteAnalytics() {
  const [counted, setCounted] = useState(false);
  useEffect(() => setCounted(isCountedHost(window.location.hostname)), []);
  if (!counted) return null;
  // `production` pins the same-origin script; `auto` would pick the
  // external debug build whenever NODE_ENV is not production.
  return <Analytics mode="production" beforeSend={beforeSend} />;
}
