// Canonical product-truth copy for action scope and reversibility.
//
// These claims intentionally distinguish Gmail label changes from a
// delivered unsubscribe request. The latter is a one-way network request
// (D58), so broad phrases such as "every action is reversible" are false.

export const ACTION_SAFETY_SUMMARY =
  'Before a manual action moves email, you see the count and what changes in Gmail. You can undo Archive, Later, and Delete from Activity until the deadline shown there. Deleted email also stays in Gmail Trash for up to 30 days unless you empty Trash sooner. A sent unsubscribe request cannot be taken back. Before an Autopilot rule starts, you see what it would do to email already in your inbox; you choose whether it acts or collects matches for your approval.';

export const ACTION_PREVIEW_CLAIM =
  'Before a manual action moves email, DeclutrMail shows how many emails are affected, a sample when available, and what will change in Gmail. DeclutrMail checks Gmail again when the action runs, so the final number can change if new email arrives first.';

// Pre-selection toolbar hint (Triage + Sender Detail). Deliberately NOT
// "Preview · before anything changes" — that's the D226 preview dialog's
// own eyebrow (9 other call sites), which renders only after a verb is
// picked. This hint renders BEFORE any verb is picked, alongside Keep,
// which dispatches immediately with no preview by design (D40) — so it
// must hold for all five verbs, not just the four that preview.
//
// QA-sender-detail-20260902-18: "DESTRUCTIVE ACTIONS PREVIEW FIRST"
// (rendered uppercase) parsed as mechanism/jargon on first read —
// "destructive" and "preview" are D226's internal vocabulary, and
// "actions preview first" reads as a noun phrase before it reads as a
// sentence. Holds for Keep too: Keep moves nothing, ever, so "nothing
// moves until you confirm" is true for it without needing a confirm step.
export const DESTRUCTIVE_ACTIONS_PREVIEW_HINT = 'Nothing moves until you confirm';

export const DELETE_RECOVERY_CLAIM =
  'Delete can be undone from Activity until the deadline shown there. It also moves email to Gmail Trash, where Gmail normally keeps it for up to 30 days unless you permanently delete it or empty Trash sooner.';

export const MANUAL_ACTION_SCOPE_CLAIM =
  'Archive, Later, and Delete apply only to the matching inbox email shown before you confirm. New email from that sender is unchanged. Autopilot handles future matches separately: you preview a rule before turning it on, then it keeps acting on matching email that arrives.';

export const BRIEF_AI_DISCLOSURE =
  'To write a Pro Brief, DeclutrMail can send Anthropic the sender, subject line, and Gmail’s short preview snippet. It never sends the full contents of an email.';

export const RECOMMENDATION_AI_DISCLOSURE =
  'To write a short explanation for a suggestion, DeclutrMail can send Anthropic the sender and engagement numbers. It does not send subject lines, preview snippets, or full email contents for this explanation.';

export const AI_PROCESSING_DISCLOSURE = `${RECOMMENDATION_AI_DISCLOSURE} ${BRIEF_AI_DISCLOSURE}`;

export const ANALYTICS_PRIVACY_CLAIM =
  'PostHog receives product-usage events, never Gmail message data.';
