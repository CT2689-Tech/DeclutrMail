// `/connect/authorize` — the OAuth consent page for the MCP connector
// (ADR-0048 rule 4, docs/spec/mcp-connector.md §4).
//
// The API's authorization endpoint parks the request and sends the
// browser here with `?request=<id>`. The page reuses the existing
// DeclutrMail session: a signed-out visitor's first read answers 401 and
// the API client sends them through Google sign-in and back to this URL.
//
// Outside the app shell on purpose — like `/onboarding`, this is one
// decision, not a place to navigate from.

import { Suspense } from 'react';
import type { Metadata } from 'next';

import { ConsentCard, ConsentScreen } from '@/features/connected-apps/consent-screen';

export const metadata: Metadata = {
  title: 'Connect an app — DeclutrMail',
  robots: { index: false, follow: false },
};

export default function ConnectAuthorizePage() {
  return (
    // `useSearchParams` needs a boundary; the fallback is the same
    // loading card the screen itself starts in.
    <Suspense fallback={<ConsentCard state={{ kind: 'loading' }} />}>
      <ConsentScreen />
    </Suspense>
  );
}
