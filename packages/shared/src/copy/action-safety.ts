// Canonical product-truth copy for action scope and reversibility.
//
// These claims intentionally distinguish Gmail label changes from a
// delivered unsubscribe request. The latter is a one-way network request
// (D58), so broad phrases such as "every action is reversible" are false.

export const ACTION_SAFETY_SUMMARY =
  'Before a manual action moves mail, you see exactly which emails are affected. You can undo Archive, Later, and Delete from Activity until the deadline shown there. Deleted email also stays in Gmail Trash for up to 30 days unless you empty Trash sooner. A sent unsubscribe request cannot be taken back. On Plus, Autopilot finds matches and waits for your approval. On Pro, rules you turn on can handle future matches automatically.';

export const ACTION_PREVIEW_CLAIM =
  'Before a manual action moves mail, DeclutrMail shows how many emails are affected, a sample when available, and what will change in Gmail. DeclutrMail checks Gmail again when the action runs, so the final number can change if new mail arrives first.';

export const DELETE_RECOVERY_CLAIM =
  'Delete can be undone from Activity until the deadline shown there. It also moves email to Gmail Trash, where Gmail normally keeps it for up to 30 days unless you permanently delete it or empty Trash sooner.';

export const MANUAL_ACTION_SCOPE_CLAIM =
  'Archive, Later, and Delete apply only to the matching inbox email shown before you confirm. New mail from that sender is unchanged. Autopilot handles future matches separately: on Plus you approve each batch, while Pro can run rules you turn on automatically.';

export const BRIEF_AI_DISCLOSURE =
  'To write a Pro Brief, DeclutrMail can send Anthropic the sender, subject line, and Gmail’s short preview snippet. It never sends the full contents of an email.';

export const RECOMMENDATION_AI_DISCLOSURE =
  'To write a short explanation for a suggestion, DeclutrMail can send Anthropic the sender and engagement numbers. It does not send subject lines, preview snippets, or full email contents for this explanation.';

export const AI_PROCESSING_DISCLOSURE = `${RECOMMENDATION_AI_DISCLOSURE} ${BRIEF_AI_DISCLOSURE}`;

export const ANALYTICS_PRIVACY_CLAIM =
  'PostHog receives product-usage events, never Gmail message data.';
