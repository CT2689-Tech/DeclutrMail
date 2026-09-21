import type { EventPayloads, Verb } from '@declutrmail/shared/observability';

import { track } from '@/lib/posthog';

type DecisionJourney = EventPayloads['action_confirmed']['journey'];

/**
 * D159 `action_confirmed` — fires only after the server accepts a
 * preview-confirmed cleanup decision. Every real KAULD confirm path
 * (Triage, Senders, Sender Detail, Screener, Brief) should call this
 * on mutation success so the activation funnel is not Triage-only.
 */
export function trackActionConfirmed(verb: Verb, journey: DecisionJourney = 'daily'): void {
  void track('action_confirmed', { journey, verb });
}
