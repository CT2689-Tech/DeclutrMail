// @declutrmail/shared/observability — privacy-scrubber + event taxonomy
// shared between API (Sentry server) and web (Sentry browser + PostHog).
//
// See `docs/observability/event-taxonomy.md` for the full list of events
// and their payload shapes. See `scrubber.ts` for the D7/D228 guarantees.

export { scrubObject, scrubTelemetryPayload } from './scrubber.js';
export type { EventName, EventPayloads, EventProps } from './events.js';
