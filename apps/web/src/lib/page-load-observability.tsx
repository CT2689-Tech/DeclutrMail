'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useReportWebVitals } from 'next/web-vitals';
import type { EventProps } from '@declutrmail/shared/observability';

import { CONSENT_CHANGE_EVENT, hasAnalyticsConsent } from './cookie-consent';
import { track } from './posthog';

type WebVitalEvent = EventProps<'web_vital_reported'>;
type WebVitalName = WebVitalEvent['metric'];
type WebVitalMetric = Parameters<Parameters<typeof useReportWebVitals>[0]>[0];

const WEB_VITAL_NAMES = new Set<WebVitalName>(['CLS', 'FCP', 'INP', 'LCP', 'TTFB']);

const EXACT_SURFACES: Record<string, WebVitalEvent['surface']> = {
  '/': 'landing',
  '/activity': 'activity',
  '/admin/security': 'admin_security',
  '/autopilot': 'autopilot',
  '/beta': 'beta',
  '/billing': 'billing',
  '/brief': 'brief',
  '/changelog': 'changelog',
  '/compare': 'compare',
  '/contact': 'contact',
  '/cookies': 'cookies',
  '/demo': 'demo',
  '/faq': 'faq',
  '/followups': 'followups',
  '/help': 'help',
  '/how-it-works': 'how_it_works',
  '/inbox-simulator': 'inbox_simulator',
  '/later': 'snoozed',
  '/methodology': 'methodology',
  '/onboarding': 'onboarding',
  '/pricing': 'pricing',
  '/privacy': 'privacy',
  '/quiet': 'quiet',
  '/refunds': 'refunds',
  '/screener': 'screener',
  '/security': 'security',
  '/senders': 'senders',
  '/settings': 'settings',
  '/settings/help': 'settings_help',
  '/settings/privacy': 'settings',
  '/settings/senders': 'settings',
  '/sign-in': 'sign_in',
  '/terms': 'terms',
  '/triage': 'triage',
};

export function pageLoadSurface(pathname: string | null): WebVitalEvent['surface'] {
  if (!pathname) return 'other';
  const normalized = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
  const exact = EXACT_SURFACES[normalized];
  if (exact) return exact;
  if (/^\/senders\/[^/]+$/.test(normalized)) return 'sender_detail';
  if (normalized === '/answers' || normalized.startsWith('/answers/')) return 'answer';
  if (normalized === '/blog' || normalized.startsWith('/blog/')) return 'blog';
  if (normalized === '/how-to' || normalized.startsWith('/how-to/')) return 'how_to';
  if (normalized.startsWith('/vs/')) return 'comparison';
  return 'other';
}

function isWebVitalName(name: string): name is WebVitalName {
  return WEB_VITAL_NAMES.has(name as WebVitalName);
}

function ratingFor(value: unknown): WebVitalEvent['rating'] {
  if (value === 'good' || value === 'needs-improvement' || value === 'poor') {
    return value === 'needs-improvement' ? 'needs_improvement' : value;
  }
  return 'unknown';
}

function navigationTypeFor(value: unknown): WebVitalEvent['navigation_type'] {
  switch (value) {
    case 'navigate':
    case 'reload':
    case 'prerender':
    case 'restore':
      return value;
    case 'back-forward':
      return 'back_forward';
    case 'back-forward-cache':
      return 'back_forward_cache';
    default:
      return 'unknown';
  }
}

/**
 * Reports real-user Core Web Vitals through the existing consent-gated
 * PostHog boundary. Metrics are buffered until consent is granted during the
 * current page load and are discarded on navigation with this component.
 */
export function PageLoadObservability() {
  const surface = useRef(
    pageLoadSurface(typeof window === 'undefined' ? null : window.location.pathname),
  );
  const pending = useRef(new Map<string, WebVitalEvent>());
  const sent = useRef(new Set<string>());

  const flush = useCallback(() => {
    if (!hasAnalyticsConsent()) return;
    for (const [id, event] of pending.current) {
      pending.current.delete(id);
      sent.current.add(id);
      void track('web_vital_reported', event).catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    window.addEventListener(CONSENT_CHANGE_EVENT, flush);
    flush();
    return () => window.removeEventListener(CONSENT_CHANGE_EVENT, flush);
  }, [flush]);

  const report = useCallback(
    (metric: WebVitalMetric) => {
      if (
        !isWebVitalName(metric.name) ||
        sent.current.has(metric.id) ||
        !Number.isFinite(metric.value) ||
        metric.value < 0
      ) {
        return;
      }
      pending.current.set(metric.id, {
        surface: surface.current,
        metric: metric.name,
        value: Math.round(metric.value * 1_000) / 1_000,
        rating: ratingFor(metric.rating),
        navigation_type: navigationTypeFor(metric.navigationType),
      });
      flush();
    },
    [flush],
  );

  useReportWebVitals(report);
  return null;
}
