// Cookie Preferences (D147) — the public change/withdrawal surface for
// the cookie-consent choice (GDPR Art. 7(3): withdrawing consent must
// be as easy as giving it). The banner asks once; this page is where
// the choice can be revisited any time — linked from the marketing
// footer and the privacy policy's cookies section. The same card is
// mounted in the app under Settings.
//
// Server component shell (legal-layout chrome, D134 no-auth invariant)
// around one client island: the CookiePreferences card, which reads and
// writes the per-browser stored choice.

import type { Metadata } from 'next';
import { CookiePreferences } from '@/features/consent/cookie-preferences';
import { LegalPageLayout, LegalSection } from '@/features/marketing/legal-layout';
import { PageViewTracker } from '@/features/marketing/page-view-tracker';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';

export const metadata: Metadata = marketingPageMetadata({
  title: 'Cookie Preferences — DeclutrMail',
  description:
    'View or change your cookie choice at any time. Essential cookies for sign-in and billing are always on; optional PostHog analytics runs only with your consent.',
  path: '/cookies',
});

const LAST_UPDATED = '2026-07-07';

const TOC = [
  { id: 'your-choice', label: 'Your choice' },
  { id: 'what-each-option-means', label: 'What each option means' },
] as const;

export default function CookiePreferencesPage() {
  return (
    <LegalPageLayout title="Cookie Preferences" lastUpdated={LAST_UPDATED} toc={TOC}>
      <PageViewTracker page="cookies" />
      <LegalSection id="your-choice" title="1. Your choice">
        <p>
          This is the choice the cookie banner asked for on your first visit. You can change or
          withdraw it here at any time — it takes effect immediately, on this browser.
        </p>
        <CookiePreferences />
      </LegalSection>

      <LegalSection id="what-each-option-means" title="2. What each option means">
        <p>
          <strong>Essential cookies</strong> keep you signed in and make billing work; they are
          required for the service to function and are always on. Your consent choice itself is also
          stored on this device so we do not ask again.
        </p>
        <p>
          <strong>Optional analytics</strong> (PostHog) runs only after you choose Accept all, and
          only to understand which features matter — it never sees your inbox content. Choosing
          Essential only stops analytics immediately and clears its identifier. We never use
          advertising cookies or cross-site trackers. Details are in the{' '}
          <a href="/privacy#cookies">privacy policy&rsquo;s cookies section</a>.
        </p>
      </LegalSection>
    </LegalPageLayout>
  );
}
