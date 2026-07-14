export { BaseDeclutrWorker } from './base-declutr-worker.js';
export type { WorkerContext } from './worker-context.js';
export { NOOP_WORKER_OBSERVER } from './worker-observer.js';
export type {
  BackgroundFailureContext,
  WorkerFailureContext,
  WorkerObserver,
} from './worker-observer.js';
export {
  AuthExpiredError,
  InvalidGrantError,
  isNonRetryable,
  PermanentError,
  RateLimitError,
  TransientError,
  ValidationError,
} from './worker-errors.js';
export type { NonRetryableError } from './worker-errors.js';
export { WORKER_POLICIES } from './worker-policies.js';
export type { ConcurrencyScope, WorkerPolicy, WorkerPolicyConfig } from './worker-policies.js';
export {
  createRedisConnection,
  ensureIncrementalSyncJob,
  ensureInitialSyncJob,
  INCREMENTAL_SYNC_JOB,
  INCREMENTAL_SYNC_QUEUE,
  incrementalSyncJobOptions,
  INITIAL_SYNC_JOB,
  INITIAL_SYNC_QUEUE,
  initialSyncJobOptions,
  workerTuningOptions,
} from './queue.js';
export type { IncrementalSyncJobData, InitialSyncJobData } from './queue.js';
export type {
  GmailAccess,
  GmailHistoryPage,
  GmailHistoryRecord,
  GmailMessageListPage,
  GmailMessageMetadata,
  GmailMetadataClient,
  GmailWatchAccess,
  GmailWatchClient,
  GmailWatchResult,
} from './ports.js';
export type {
  GmailMutationAccess,
  GmailMutationClient,
  LabelChange,
} from './gmail-mutation-client.js';
export {
  LABEL_ACTION_JOB,
  LABEL_ACTION_QUEUE,
  LabelActionWorker,
  labelActionJobOptions,
  labelChangeForVerb,
  PASSTHROUGH_MAILBOX_LOCK,
} from './label-action.worker.js';
export type {
  LabelActionDeps,
  LabelActionJobData,
  LabelActionResult,
  MailboxActionLock,
} from './label-action.worker.js';
export {
  FETCH_UNSUB_HTTP_PORT,
  UNSUB_EXECUTION_JOB,
  UNSUB_EXECUTION_QUEUE,
  UNSUB_MAX_ATTEMPTS,
  UNSUB_REQUEST_TIMEOUT_MS,
  UnsubExecutionWorker,
  unsubExecutionJobOptions,
} from './unsub-execution.worker.js';
export type {
  UnsubExecutionDeps,
  UnsubExecutionJobData,
  UnsubExecutionResult,
  UnsubHttpPort,
  UnsubHttpResponse,
} from './unsub-execution.worker.js';
export { DrizzleDeadLetterRecorder } from './dead-letter.recorder.js';
export type { DeadLetterEntry, DeadLetterRecorder } from './dead-letter.recorder.js';
export { DeadLetterWorker, replayDeadLetterJob } from './dead-letter.worker.js';
export type {
  DeadLetterReplayOutcome,
  DeadLetterReplayTarget,
  DeadLetterSweepJobData,
  DeadLetterSweepResult,
} from './dead-letter.worker.js';
export {
  DEAD_LETTER_INTERVAL_MS,
  DEAD_LETTER_JOB,
  DEAD_LETTER_QUEUE,
  deadLetterJobOptions,
  enqueueDeadLetterTick,
  scheduledAtMinute as deadLetterScheduledAtMinute,
} from './dead-letter.queue.js';
export { deriveSenderKey, emailDomain, normalizeEmail, parseFromHeader } from './sender-key.js';
export type { ParsedSender } from './sender-key.js';
export { parseListUnsubscribe, parseRecipients } from './header-parsing.js';
export { RateLimiter } from './rate-limiter.js';
export type { RateLimiterClock } from './rate-limiter.js';
export { InitialSyncWorker } from './initial-sync.worker.js';
export type { InitialSyncDeps, InitialSyncResult } from './initial-sync.worker.js';
export { IncrementalSyncWorker } from './incremental-sync.worker.js';
export type { IncrementalSyncDeps, IncrementalSyncResult } from './incremental-sync.worker.js';
export {
  createLimiter,
  DEFAULT_EXPLAIN_TIMEOUT_MS,
  DEFAULT_REASONING_CONCURRENCY,
  DEFAULT_REASONING_RATE_PER_MIN,
  MAX_REASONING_CONCURRENCY,
  MAX_REASONING_RATE_PER_MIN,
  renderTemplate,
  resolveExplainTimeoutMs,
  resolveReasoningConcurrency,
  resolveReasoningRatePerMin,
  runWithTimeout,
  VERDICT_LABEL,
  VERDICT_RUNTIME_VALUES,
} from './reasoning.js';
export type { ConcurrencyLimiter, ReasoningInput, ReasoningLlmPort } from './reasoning.js';
export { isGovernmentDomain, runCascade } from './score-cascade.js';
export type {
  CascadePhase,
  CascadeResult,
  CascadeRuleId,
  SenderSignals,
  UnsubscribeChannel,
} from './score-cascade.js';
export { AUTOPILOT_PRESETS } from './autopilot-presets.js';
export type {
  PresetDefinition,
  PresetInput,
  PresetMatchResult,
  PresetSignals,
} from './autopilot-presets.js';
export { seedAutopilotPresets } from './autopilot-preset-seeder.js';
export {
  AUTOPILOT_APPLY_JOB,
  AUTOPILOT_APPLY_QUEUE,
  AutopilotApplyWorker,
} from './autopilot-apply.worker.js';
export type {
  AutopilotApplyDeps,
  AutopilotApplyJobData,
  AutopilotApplyJobResult,
} from './autopilot-apply.worker.js';
export { materializeAutopilotSignals } from './autopilot-signals.js';
export type { AutopilotSignalRow } from './autopilot-signals.js';
export {
  AUTOPILOT_APPLY_DELTA_WINDOW_MS,
  buildAutopilotApplyDeltaTrigger,
} from './autopilot-delta-trigger.js';
export {
  AUTOPILOT_ACTION_JOB,
  AUTOPILOT_ACTION_QUEUE,
  autopilotActionJobOptions,
  AutopilotActionWorker,
  isQuietStateActive,
} from './autopilot-action.worker.js';
export type {
  AutopilotActionDeps,
  AutopilotActionJobData,
  AutopilotActionResult,
} from './autopilot-action.worker.js';
// U18 quiet hours — persistence (jsonb MERGE, co-tenant contract) +
// the combined quiet predicate the action sweep defers on (D92/D93).
// `isQuietStateActive` ships via the autopilot-action re-export above.
export {
  isQuietActive,
  msUntilQuietEnds,
  persistQuietHoursState,
  QUIET_HOURS_STATE_KEY,
  readQuietHoursState,
} from './quiet-hours-state.js';
export { createAutopilotExecutionChain } from './autopilot-execution-chain.js';
export type { AutopilotExecutionChain } from './autopilot-execution-chain.js';
export { BriefSnapshotWorker } from './brief-snapshot.worker.js';
export type {
  BriefSnapshotDeps,
  BriefSnapshotJobData,
  BriefSnapshotResult,
} from './brief-snapshot.worker.js';
export {
  BRIEF_FYI_MAX,
  BRIEF_REPLY_MAX,
  briefItemSchema,
  briefPayloadSchema,
  briefSenderGroupSchema,
  DEFAULT_BRIEF_LLM_TIMEOUT_MS,
  EMPTY_BRIEF_NARRATIVE,
  EMPTY_BRIEF_PAYLOAD,
  renderTemplateNarrative as renderBriefTemplateNarrative,
  resolveBriefLlmTimeoutMs,
} from './brief-narrative.js';
export type {
  BriefLlmPort,
  BriefNarrativeInput,
  BriefNarrativeItem,
  BriefNarrativeNoiseGroup,
} from './brief-narrative.js';
export {
  BRIEF_SNAPSHOT_INTERVAL_MS,
  BRIEF_SNAPSHOT_JOB,
  BRIEF_SNAPSHOT_QUEUE,
  briefSnapshotJobOptions,
  enqueueBriefSnapshotTick,
  scheduledAtMinute as briefSnapshotScheduledAtMinute,
} from './brief-snapshot.queue.js';
export { FollowupCheckWorker } from './followup-check.worker.js';
export type {
  FollowupCheckDeps,
  FollowupCheckJobData,
  FollowupCheckResult,
} from './followup-check.worker.js';
export {
  enqueueFollowupCheckTick,
  FOLLOWUP_CHECK_INTERVAL_MS,
  FOLLOWUP_CHECK_JOB,
  FOLLOWUP_CHECK_QUEUE,
  followupCheckJobOptions,
  scheduledAtMinute as followupCheckScheduledAtMinute,
} from './followup-check.queue.js';
export { SCORE_JOB, SCORE_QUEUE, ScoreWorker } from './score.worker.js';
export type {
  ScoreJobData,
  ScoreJobResult,
  ScoreTrigger,
  ScoreWorkerDeps,
} from './score.worker.js';
export { OUTBOX_NOTIFY_CHANNEL, OutboxDispatcherWorker } from './outbox-dispatcher.worker.js';
export type {
  DispatchedEvent,
  DispatcherTickResult,
  OutboxConsumer,
  OutboxDispatcherDeps,
  OutboxObserver,
} from './outbox-dispatcher.worker.js';
export { OutboxPublisher } from './outbox-publisher.js';
export type { OutboxPublishInput, OutboxTx } from './outbox-publisher.js';
export { UndoExpiryWorker } from './undo-expiry.worker.js';
export type { UndoExpiryJobData, UndoExpiryResult } from './undo-expiry.worker.js';
export {
  enqueueUndoExpiryTick,
  scheduledAtMinute,
  UNDO_EXPIRY_INTERVAL_MS,
  UNDO_EXPIRY_JOB,
  UNDO_EXPIRY_QUEUE,
  undoExpiryJobOptions,
} from './undo-expiry.queue.js';
export { WatchRenewalWorker } from './watch-renewal.worker.js';
export type {
  WatchRenewalDeps,
  WatchRenewalJobData,
  WatchRenewalResult,
} from './watch-renewal.worker.js';
export {
  enqueueWatchRenewalTick,
  WATCH_RENEWAL_INTERVAL_MS,
  WATCH_RENEWAL_JOB,
  WATCH_RENEWAL_QUEUE,
  watchRenewalJobOptions,
} from './watch-renewal.queue.js';
export {
  clearGmailWatchState,
  GMAIL_WATCH_STATE_KEY,
  persistGmailWatchState,
  readGmailWatchState,
} from './gmail-watch-state.js';
export type { GmailWatchState } from './gmail-watch-state.js';
export { SendersCounterReconciliationWorker } from './senders-counter-reconciliation.worker.js';
export type {
  SendersCounterReconciliationJobData,
  SendersCounterReconciliationResult,
} from './senders-counter-reconciliation.worker.js';
export {
  enqueueSendersCounterReconciliationTick,
  scheduledAtMinute as sendersCounterReconciliationScheduledAtMinute,
  SENDERS_COUNTER_RECONCILIATION_INTERVAL_MS,
  SENDERS_COUNTER_RECONCILIATION_JOB,
  SENDERS_COUNTER_RECONCILIATION_QUEUE,
  sendersCounterReconciliationJobOptions,
} from './senders-counter-reconciliation.queue.js';
export {
  deletionPendingSql,
  hasInFlightDeletion,
  hasInFlightMailboxDataDeletion,
  isSyncPausedForDeletion,
} from './deletion-pause.js';
export {
  AccountDeletionPurgeWorker,
  MAILBOX_PURGE_DIRECT_CHILD_TABLES,
} from './deletion.worker.js';
export type {
  DeletionPurgeDeps,
  DeletionSweepJobData,
  DeletionSweepResult,
} from './deletion.worker.js';
export {
  DELETION_SWEEP_INTERVAL_MS,
  DELETION_SWEEP_JOB,
  DELETION_SWEEP_QUEUE,
  deletionSweepJobOptions,
  enqueueDeletionSweepTick,
} from './deletion.queue.js';
export { EmailSendWorker } from './email-send.worker.js';
export type {
  EmailDeliveryOutcome,
  EmailDeliveryPort,
  EmailKind,
  EmailSendJobData,
  EmailSendResult,
  EmailSendWorkerDeps,
} from './email-send.worker.js';
export {
  EMAIL_SEND_JOB,
  EMAIL_SEND_QUEUE,
  emailSendJobOptions,
  enqueueEmailSend,
  SYNC_REMINDER_DELAY_MS,
  syncCompleteEmailJobId,
  syncReminderEmailJobId,
} from './email-send.queue.js';
export { SnoozeWakeWorker, laterLabelName } from './snooze-wake.worker.js';
export type { SnoozeWakeDeps, SnoozeWakeJobData, SnoozeWakeResult } from './snooze-wake.worker.js';
export {
  enqueueSnoozeWakeNow,
  enqueueSnoozeWakeTick,
  RedisSnoozeLabelMapStore,
  SNOOZE_LATER_LABEL_TTL_SECONDS,
  SNOOZE_WAKE_INTERVAL_MS,
  SNOOZE_WAKE_JOB,
  SNOOZE_WAKE_QUEUE,
  snoozeLaterLabelKey,
  snoozeScheduledAtMinute,
  snoozeSweepJobId,
  snoozeWakeJobOptions,
  snoozeWakeNowJobId,
} from './snooze-wake.queue.js';
export type { SnoozeLabelMapRedis, SnoozeLabelMapStore } from './snooze-wake.queue.js';
