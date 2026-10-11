/**
 * Domain owner: growth: WS3.
 *
 * Append new growth events here. Do not rename existing events.
 */
import type { Verb, PageSurface } from './vocabulary.js';

export const GROWTH_EVENT_NAMES = [
  'page_viewed',
  'landing_cta_clicked',
  'demo_preview_opened',
  'demo_decision_confirmed',
  'demo_completed',
  'demo_reset',
  'beta_gate_denied',
  'provider_waitlist_joined',
] as const;

export type GrowthEventName = (typeof GROWTH_EVENT_NAMES)[number];

export interface GrowthEventPayloads {
  // — Page-view + navigation funnel —
  page_viewed: {
    page: PageSurface;
    mailbox_id: string | null;
  };

  // — Marketing landing funnel (D134) —
  landing_cta_clicked: {
    /** Which CTA — `connect_gmail` starts OAuth; `open_app` is the authed shortcut. */
    cta: 'connect_gmail' | 'sign_in' | 'open_app' | 'see_pricing' | 'try_demo';
    /**
     * Positional section on the current public page; page_viewed carries the
     * route family. `nav_sign_in` is the header's secondary returning-user
     * affordance — kept distinct from `nav` so the primary "Start free" CTA
     * keeps a comparable series after both started emitting (2026-08-05).
     */
    placement: 'nav' | 'nav_sign_in' | 'hero' | 'pricing_teaser' | 'final' | 'demo';
  };

  demo_preview_opened: {
    verb: Verb;
    decision_index: number;
  };

  demo_decision_confirmed: {
    verb: Verb;
    decision_index: number;
    affected_messages: number;
  };

  demo_completed: {
    decisions_completed: number;
    affected_messages: number;
  };

  demo_reset: {
    decisions_completed: number;
  };

  // — Private-beta gate (buildout F7) —
  beta_gate_denied: {
    /** What surfaced the denial — only the OAuth-callback redirect today. */
    source: 'oauth_callback';
  };

  /**
   * "Not on Gmail?" waitlist. Closed enums only — never the address.
   * `provider` is the visitor's pick; `provider_class` is the server classifier.
   */
  provider_waitlist_joined: {
    provider: 'outlook' | 'm365' | 'yahoo_aol' | 'icloud' | 'other' | 'unspecified';
    provider_class:
      'gmail' | 'google_workspace' | 'microsoft' | 'yahoo_aol' | 'icloud' | 'other' | 'unknown';
    would_pay: boolean;
  };
}
