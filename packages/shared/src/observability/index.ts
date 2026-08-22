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
  // Canonical server-profile exception class names. Exported so the API's
  // exception filter attributes errors from the SAME set the scrubber
  // accepts — a producer list that drifts from the consumer list is how
  // every 5xx ended up on the wire with no type at all.
  SENTRY_SERVER_EXCEPTION_TYPES,
  isSentryServerExceptionType,
  type SentryScrubProfile,
} from './sentry-scrubber.js';
export type { EventName, EventPayloads, EventProps, OnboardingFunnelStep, Verb } from './events.js';
