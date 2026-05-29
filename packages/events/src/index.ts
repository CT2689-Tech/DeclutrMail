/**
 * @declutrmail/events — D204 typed cross-feature event contracts.
 *
 * Every event the outbox dispatcher (D13) routes is declared here as
 * a Zod schema + topic constant + payload TypeScript type. Publishers
 * pass the schema to `OutboxPublisher.publish({schema})`; the
 * publisher runs `schema.parse(payload)` before insert, then the PII-
 * key denylist (defense-in-depth per D7 / D228).
 *
 * See `events.ts` for the schemas, `topics.ts` for the topic
 * constants + `EventTopic` union.
 */

export {
  ActionLabelAppliedPayloadSchema,
  AutopilotActionIntentEmittedPayloadSchema,
  AutopilotMatchRecordedPayloadSchema,
  EVENT_SCHEMAS,
  FollowupDismissedPayloadSchema,
  MailboxDeletedPayloadSchema,
  MailboxSyncReadyPayloadSchema,
  TriageDecisionRecomputedPayloadSchema,
  TriageScoreRunCompletedPayloadSchema,
  TriageVerdictAppliedPayloadSchema,
} from './events.js';
export type {
  ActionLabelAppliedPayload,
  AutopilotActionIntentEmittedPayload,
  AutopilotMatchRecordedPayload,
  EventPayloadByTopic,
  FollowupDismissedPayload,
  MailboxDeletedPayload,
  MailboxSyncReadyPayload,
  TriageDecisionRecomputedPayload,
  TriageScoreRunCompletedPayload,
  TriageVerdictAppliedPayload,
} from './events.js';
export { isEventTopic, TOPICS } from './topics.js';
export type { EventTopic } from './topics.js';
