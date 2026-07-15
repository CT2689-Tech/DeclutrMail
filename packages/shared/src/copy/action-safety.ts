// Canonical product-truth copy for action scope and reversibility.
//
// These claims intentionally distinguish Gmail label changes from a
// delivered unsubscribe request. The latter is a one-way network request
// (D58), so broad phrases such as "every action is reversible" are false.

export const ACTION_SAFETY_SUMMARY =
  'Manual sender cleanup in Triage and Senders shows a current-scope preview before mail moves. Manual Archive, Later, and Delete can be reversed from Activity for your plan’s undo window. Delete also has Gmail Trash recovery, normally for up to 30 days; emptying Trash can end that separate fallback sooner. A delivered unsubscribe request cannot be recalled. Observe-mode Autopilot approvals show the sender scope; enabled Pro rules apply future matches without a new per-message approval.';

export const ACTION_PREVIEW_CLAIM =
  'Before a manual sender-cleanup action in Triage or Senders moves mail, DeclutrMail shows the current matching count, a sample when available, and the planned Gmail changes. The worker re-checks Gmail at execution, so the final affected count can change if the inbox changes in between.';

export const DELETE_RECOVERY_CLAIM =
  'Delete uses your plan’s Activity Undo window and moves mail to Gmail Trash. Gmail normally retains Trash for up to 30 days, but permanently deleting a message or emptying Trash can end that separate recovery fallback sooner.';

export const MANUAL_ACTION_SCOPE_CLAIM =
  'Manual Archive, Later, and Delete actions apply to matching inbox messages when the worker executes. A preview shows the current count and an available sample, so the final affected count can change if the inbox changes in between. These actions do not create future-mail rules. Pro Autopilot applies enabled preset rules to future matches.';

export const BRIEF_AI_DISCLOSURE =
  'Pro Brief can send sender identity, subject, and Gmail’s short preview snippet to Anthropic to generate its narrative. Full message bodies are never fetched or sent.';

export const RECOMMENDATION_AI_DISCLOSURE =
  'Recommendation explanations can send Anthropic the sender identity and domain plus numerical engagement signals and the deterministic verdict; they do not send subject lines, Gmail preview snippets, or message bodies.';

export const AI_PROCESSING_DISCLOSURE = `${RECOMMENDATION_AI_DISCLOSURE} ${BRIEF_AI_DISCLOSURE}`;

export const ANALYTICS_PRIVACY_CLAIM =
  'PostHog receives product-usage events, never Gmail message data.';
