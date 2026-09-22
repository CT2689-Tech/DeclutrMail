import { ProductJourney } from '@/features/marketing/landing/product-journey';
import type { Metadata } from 'next';

import '@/features/marketing/landing/landing.css';
import { Hero } from '@/features/marketing/landing/hero';
import { HowItWorks, PrivacyDesk } from '@/features/marketing/landing/sections';
import { PricingTeaserView } from '@/features/marketing/landing/pricing-teaser-view';
import { FinalCta } from '@/features/marketing/landing/footer';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';

/**
 * Public landing page at `/`.
 *
 * Renders inside the `(marketing)` route group — NO AuthProvider in
 * the chain, no auth round-trip before paint. Auth CTAs open the
 * public permission checkpoint before the final Google OAuth hop.
 *
 * Hero + demo → workspace journey → how it works → privacy →
 * pricing teaser → final CTA. The FAQ (and its FAQPage JSON-LD) lives on
 * /faq and /help, not here — Google does not allow FAQ markup for answers
 * the page does not visibly render. D136 still ships no testimonials
 * without first-party evidence. Product comparisons live on their
 * source-backed dedicated routes.
 */

const TITLE = 'Clean up Gmail, one sender at a time — DeclutrMail';
const DESCRIPTION =
  'Clear Gmail clutter by sender. Preview which emails will move before you confirm. Start free, with 30-day undo on Archive, Later, and Delete.';

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
 * explicit Paddle display rail). `/pricing` still quotes INR to India,
 * and `/billing` — where checkout actually opens — reads geo server-side
 * and charges correctly. No one is charged a price they were not shown
 * at the point of sale; the landing strip is simply denominated in USD.
 */
export default function LandingPage() {
  return (
    <div className="dm-mkt dm-mkt-landing">
      <Hero />
      <ProductJourney />
      <HowItWorks />
      <PrivacyDesk />
      <PricingTeaserView provider="paddle" />
      <FinalCta />
    </div>
  );
}
