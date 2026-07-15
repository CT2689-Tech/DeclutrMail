import type { Metadata } from 'next';

import '@/features/marketing/landing/landing.css';
import { Hero } from '@/features/marketing/landing/hero';
import {
  GmailCompanion,
  HowItWorks,
  PrivacyDesk,
  Problem,
  ProductTour,
  Ritual,
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
 * awareness is intentionally absent; Sign in is an explicit public route.
 *
 * Section order follows D134, trimmed to the launch surface:
 * hero → trust strip → problem → how-it-works → ritual (K/A/U/L/D)
 * → privacy posture → pricing teaser → FAQ → final CTA → footer.
 * D136 still ships no testimonials without first-party evidence. Product
 * comparisons live on their source-backed dedicated routes.
 */

const TITLE = 'DeclutrMail — Control Gmail by sender, not by email.';
const DESCRIPTION =
  'DeclutrMail turns thousands of emails into a handful of sender decisions — with automation, privacy-first indexing, and 7-day Activity Undo for Archive, Later, and Delete on Free.';

// metadataBase is inherited from the root layout (D128 origin).
export const metadata: Metadata = marketingPageMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: '/',
});

export default function LandingPage() {
  return (
    <div className="dm-mkt">
      <div className="dm-mkt-shell">
        <Hero />
      </div>
      <Problem />
      <HowItWorks />
      <Ritual />
      <PrivacyDesk />
      <ProductTour />
      <GmailCompanion />
      <PricingTeaser />
      <Faq />
      <FinalCta />
    </div>
  );
}
