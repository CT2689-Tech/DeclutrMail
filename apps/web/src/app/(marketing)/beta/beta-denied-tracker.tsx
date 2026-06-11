'use client';

// Fires the D159 `beta_gate_denied` observability event exactly once
// on mount. Rendered ONLY when /beta was reached via the OAuth
// callback's denial redirect (`?reason=not_invited`) — organic visits
// never mount this component, so the metric counts real gate denials.
//
// Privacy (D7, D159): the payload is a closed enum only — the denied
// email NEVER reaches telemetry. The founder-facing audit trail with
// the email lives in `security_events` (`signup.denied`, D181).

import { useEffect } from 'react';

import { track } from '@/lib/posthog';

export function BetaDeniedTracker() {
  useEffect(() => {
    void track('beta_gate_denied', { source: 'oauth_callback' });
  }, []);
  return null;
}
