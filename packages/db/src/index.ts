export * as schema from './schema';
export { actionDirection, actionJobStatus, actionJobs, actionVerb } from './schema/action-jobs';
export type { ActionJob, LabelActionSelector, NewActionJob } from './schema/action-jobs';
// Closed enums derived from the canonical pg_enum — adding a value to
// the migration widens the type without a coordinated literal-union
// edit at every consumer. Pattern: `triageVerdict.enumValues` in
// `packages/workers/src/reasoning.ts`.
import type {
  actionJobStatus as _actionJobStatus,
  actionVerb as _actionVerb,
} from './schema/action-jobs';
export type ActionJobStatus = (typeof _actionJobStatus.enumValues)[number];
export type ActionVerb = (typeof _actionVerb.enumValues)[number];
export { activeSessions } from './schema/active-sessions';
export type { ActiveSession, NewActiveSession } from './schema/active-sessions';
export { activityAction, activityLog, activitySource } from './schema/activity-log';
export type { ActivityLogEntry, NewActivityLogEntry } from './schema/activity-log';
export {
  AUTOPILOT_PRESET_KEYS,
  autopilotActionKind,
  autopilotRuleMode,
  autopilotRuleScope,
  automationRules,
} from './schema/automation-rules';
export type {
  AutomationRule,
  AutopilotActionKind,
  AutopilotPresetKey,
  AutopilotRuleMode,
  AutopilotRuleScope,
  NewAutomationRule,
} from './schema/automation-rules';
export { briefGeneratedBy, briefRuns } from './schema/brief-runs';
export type {
  BriefGeneratedBy,
  BriefItem,
  BriefPayload,
  BriefRun,
  BriefSenderGroup,
  NewBriefRun,
} from './schema/brief-runs';
export { followupStatus, followupTracker } from './schema/followup-tracker';
export type {
  FollowupStatus,
  FollowupTracker,
  NewFollowupTracker,
} from './schema/followup-tracker';
export { mailMessages } from './schema/mail-messages';
export type { MailMessage, NewMailMessage } from './schema/mail-messages';
export { mailboxAccounts, mailboxProvider, mailboxStatus } from './schema/mailbox-accounts';
export type { MailboxAccount, NewMailboxAccount } from './schema/mailbox-accounts';
export { outboxEvents, outboxStatus } from './schema/outbox-events';
export type { NewOutboxEvent, OutboxEvent, OutboxStatus } from './schema/outbox-events';
export { providerSyncState, syncReadiness, syncStage } from './schema/provider-sync-state';
export type { NewProviderSyncState, ProviderSyncState } from './schema/provider-sync-state';
export {
  autopilotMatchMode,
  autopilotMatchResolution,
  ruleMatchLog,
} from './schema/rule-match-log';
export type {
  AutopilotMatchMode,
  AutopilotMatchResolution,
  NewRuleMatchLog,
  RuleMatchLog,
} from './schema/rule-match-log';
export { securityEvents } from './schema/security-events';
export type { NewSecurityEvent, SecurityEvent } from './schema/security-events';
export { protectionReason, senderPolicies, senderPolicyType } from './schema/sender-policies';
export type { NewSenderPolicy, SenderPolicy } from './schema/sender-policies';
export { senderTimeseries } from './schema/sender-timeseries';
export type { NewSenderTimeseries, SenderTimeseries } from './schema/sender-timeseries';
export { gmailCategory, gmailUnsubscribeMethod, senders } from './schema/senders';
export type { NewSender, Sender } from './schema/senders';
import type { gmailCategory as _gmailCategory } from './schema/senders';
export type GmailCategory = (typeof _gmailCategory.enumValues)[number];
export { triageDecisions, triageReasoningSource, triageVerdict } from './schema/triage-decisions';
export type {
  NewTriageDecision,
  TriageDecision,
  TriageReasoningSource,
  TriageVerdict,
} from './schema/triage-decisions';
export { undoActionKind, undoJournal } from './schema/undo-journal';
export type { NewUndoJournalEntry, UndoJournalEntry } from './schema/undo-journal';
export { users } from './schema/users';
export type { NewUser, User } from './schema/users';
export { webhookDedup } from './schema/webhook-dedup';
export type { NewWebhookDedup, WebhookDedup } from './schema/webhook-dedup';
export { workspaces, workspaceTier } from './schema/workspaces';
export type { NewWorkspace, Workspace } from './schema/workspaces';
