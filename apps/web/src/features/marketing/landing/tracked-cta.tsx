'use client';

import type { ReactNode } from 'react';

import { track } from '@/lib/posthog';

type LandingCta = 'connect_gmail' | 'open_app' | 'see_pricing';
type LandingPlacement = 'nav' | 'hero' | 'pricing_teaser' | 'final';

/**
 * Anchor that fires the D159 `landing_cta_clicked` funnel event on
 * click, then lets the browser follow the href normally. Plain <a>
 * (not next/link) on purpose: `connect_gmail` is a cross-origin hop
 * to the API's OAuth start endpoint, and `/senders` re-enters the
 * authed app shell — neither benefits from client-side routing.
 */
export function TrackedCta({
  href,
  cta,
  placement,
  className,
  children,
}: {
  href: string;
  cta: LandingCta;
  placement: LandingPlacement;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      className={className}
      onClick={() => {
        // Fire-and-forget: navigation must never wait on telemetry.
        void track('landing_cta_clicked', { cta, placement });
      }}
    >
      {children}
    </a>
  );
}
