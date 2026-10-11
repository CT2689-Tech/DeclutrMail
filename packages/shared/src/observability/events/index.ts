/**
 * Closed union of PostHog event names (D159).
 *
 * Split by domain so each workstream appends only to its own file:
 * billing (WS1), app (WS2), report (WS5), growth (WS3), ops (WS4).
 *
 * Adding a new event requires:
 * 1. Append the literal in the owning domain file.
 * 2. Document name, trigger, payload shape, retention in
 *    `docs/observability/event-taxonomy.md`.
 * 3. (Optional) Add a discriminated entry to that file's payload
 *    interface if the event ships structured properties.
 *
 * Keeping this union closed means typos at call sites become compile
 * errors — there are no accidental new event names in production.
 */
import type { AppEventName, AppEventPayloads } from './app.js';
import { APP_EVENT_NAMES } from './app.js';
import type { BillingEventName, BillingEventPayloads } from './billing.js';
import { BILLING_EVENT_NAMES } from './billing.js';
import type { GrowthEventName, GrowthEventPayloads } from './growth.js';
import { GROWTH_EVENT_NAMES } from './growth.js';
import type { OpsEventName, OpsEventPayloads } from './ops.js';
import { OPS_EVENT_NAMES } from './ops.js';
import type { ReportEventName, ReportEventPayloads } from './report.js';
import { REPORT_EVENT_NAMES } from './report.js';

export type {
  ActivationGoal,
  DecisionJourney,
  OnboardingFunnelStep,
  PageSurface,
  Verb,
} from './vocabulary.js';

export type EventName =
  BillingEventName | AppEventName | ReportEventName | GrowthEventName | OpsEventName;

export interface EventPayloads
  extends
    BillingEventPayloads,
    AppEventPayloads,
    ReportEventPayloads,
    GrowthEventPayloads,
    OpsEventPayloads {}

/**
 * Helper type that resolves the payload for a given event name.
 * Used by the `track()` wrapper to enforce payload shape at call sites.
 */
export type EventProps<E extends EventName> = E extends keyof EventPayloads
  ? EventPayloads[E]
  : Record<string, never>;

/** Runtime list of every event name. The split test pins this to the pre-split union. */
export const EVENT_NAMES = [
  ...BILLING_EVENT_NAMES,
  ...APP_EVENT_NAMES,
  ...REPORT_EVENT_NAMES,
  ...GROWTH_EVENT_NAMES,
  ...OPS_EVENT_NAMES,
] as const;
