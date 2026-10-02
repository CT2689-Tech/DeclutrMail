import { useEffect, useRef } from 'react';
import type { EventPayloads, Verb } from '@declutrmail/shared/observability';
import { track } from './posthog';
type DecisionJourney = EventPayloads['action_preview_viewed']['journey'];

/** One loaded preview per opening/verb; refetches and StrictMode do not duplicate it. */
export function useActionPreviewAnalytics(
  key: string | null,
  verb: Verb,
  ready: boolean,
  journey: DecisionJourney = 'daily',
) {
  const observed = useRef<string | null>(null);
  useEffect(() => {
    if (key === null) {
      observed.current = null;
      return;
    }
    if (!ready) return;
    const identity = `${journey}:${key}:${verb}`;
    if (observed.current === identity) return;
    observed.current = identity;
    void track('action_preview_viewed', { journey, verb });
  }, [key, verb, ready, journey]);
}
