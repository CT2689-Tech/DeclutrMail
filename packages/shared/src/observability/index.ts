// @declutrmail/shared/observability — privacy-scrubber + event taxonomy
// shared between API (Sentry server) and web (Sentry browser + PostHog).
//
// See `docs/observability/event-taxonomy.md` for the full list of events
// and their payload shapes. See `scrubber.ts` (generic/PostHog) and
// `sentry-scrubber.ts` (Sentry wire) for the D7/D228 guarantees.

export { scrubObject, scrubTelemetryPayload, scrubUrlDerived } from './scrubber.js';
// Kept in a separate module so the eager browser path (PostHog) does not
// pull the Sentry scrubbers into a first-load chunk — see the header of
// `sentry-scrubber.ts` (D160).
export {
  scrubSentryBreadcrumb,
  scrubSentryEvent,
  scrubSentryLog,
  scrubSentryTransaction,
  type SentryScrubProfile,
} from './sentry-scrubber.js';
export type { EventName, EventPayloads, EventProps, OnboardingFunnelStep, Verb } from './events.js';
