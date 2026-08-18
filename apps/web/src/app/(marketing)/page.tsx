import type { Metadata } from 'next';

import '@/features/marketing/landing/landing.css';
import { Hero } from '@/features/marketing/landing/hero';
import {
  GmailCompanion,
  HowItWorks,
  PrivacyDesk,
  Problem,
} from '@/features/marketing/landing/sections';
import { PricingTeaser } from '@/features/marketing/landing/pricing-teaser';
import { Faq } from '@/features/marketing/landing/faq';
import { FinalCta } from '@/features/marketing/landing/footer';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';

/**
 * Public landing page at `/` (D134 structure, D223 locked headline).
 *
 * Renders inside the `(marketing)` route group — NO AuthProvider in
 * the chain, no auth round-trip before paint. The only session
 * awareness is intentionally absent; auth CTAs start Google OAuth directly.
 *
 * Section order follows D134, trimmed to the launch surface:
 * hero → trust strip → problem → how-it-works + action outcomes
 * → privacy posture → Gmail companion → pricing teaser → FAQ → final CTA → footer.
 * D136 still ships no testimonials without first-party evidence. Product
 * comparisons live on their source-backed dedicated routes.
 */

const TITLE = 'Preview Gmail cleanup by sender — DeclutrMail';
const DESCRIPTION =
  'Review Gmail by sender with Keep, Archive, Unsubscribe, Later, and Delete. See the exact count and Gmail changes before a manual move, then verify in Activity.';

// metadataBase is inherited from the root layout (D128 origin).
export const metadata: Metadata = marketingPageMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: '/',
});

/**
 * STATIC. The landing page is prerendered, and that is load-bearing for
 * more than speed.
 *
 * It was briefly dynamic (#525) so `PricingTeaser` could quote the
 * visitor's rail — INR for India. Adding the D160 Lighthouse gate
 * surfaced what that cost: **Next defers ALL metadata out of `<head>` on
 * a dynamic route.** Measured on a production build, `/` shipped its
 * `<title>`, description, canonical, and every `og:`/`twitter:` tag at
 * byte ~37,800, long past `</head>` at byte ~2,045, for React to hoist
 * during hydration. Google executes JS and would cope. Social and chat
 * crawlers — X, LinkedIn, Slack, Discord — do not: they read raw
 * `<head>` and stop. Every share of declutrmail.com rendered as a blank
 * card, on the one URL a launch gets shared as.
 *
 * Moving the read into a `<Suspense>` boundary does not help; the
 * deferral follows the ROUTE being dynamic, not the component tree. So
 * the choice is binary, and a working link preview on the most-shared
 * page beats currency precision on a teaser strip that links to
 * `/pricing` for the real grid.
 *
 * What this costs: the teaser quotes USD to everyone (the
 * `useRegionProvider` default). `/pricing` still quotes INR to India,
 * and `/billing` — where checkout actually opens — reads geo server-side
 * and charges correctly. No one is charged a price they were not shown
 * at the point of sale; the landing strip is simply denominated in USD.
 */
export default function LandingPage() {
  return (
    <div className="dm-mkt">
      <div className="dm-mkt-shell">
        <Hero />
      </div>
      <Problem />
      <HowItWorks />
      <PrivacyDesk />
      <GmailCompanion />
      <PricingTeaser />
      <Faq />
      <FinalCta />
    </div>
  );
}
