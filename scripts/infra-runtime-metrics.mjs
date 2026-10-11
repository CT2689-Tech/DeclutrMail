/** Aggregate-only five-minute worker observations. Log distributions are samples, not gauges. */
const WORKER =
  'resource.type="cloud_run_revision" AND resource.labels.service_name="declutrmail-worker"';
function distribution(name, kind, field, unit, labels = []) {
  return {
    name,
    description: `Five-minute runtime observation: ${field}. Missing observations are unknown; never infer zero.`,
    filter: `${WORKER} AND jsonPayload.kind="${kind}" AND jsonPayload.${field}:*`,
    metricDescriptor: {
      metricKind: 'DELTA',
      valueType: 'DISTRIBUTION',
      unit,
      labels: labels.map((key) => ({
        key,
        valueType: 'STRING',
        description: `Closed application ${key} enum`,
      })),
    },
    valueExtractor: `EXTRACT(jsonPayload.${field})`,
    labelExtractors: Object.fromEntries(labels.map((key) => [key, `EXTRACT(jsonPayload.${key})`])),
    bucketOptions:
      unit === '1' && field === 'utilizationRatio'
        ? { linearBuckets: { numFiniteBuckets: 100, width: 0.01, offset: 0 } }
        : { exponentialBuckets: { numFiniteBuckets: 60, growthFactor: 1.5, scale: 0.001 } },
  };
}
export const RECONNECT_EMAIL_OUTCOMES = [
  'sent',
  'skipped_user_returned',
  'skipped_opted_out',
  'skipped_recovered',
  'skipped_suppressed',
  'skipped_no_recipient',
  'skipped_no_postal_address',
  'skipped_delivery_disabled',
  'skipped_delivery_rejected',
];
const ACTION_LABELS = ['direction', 'verb', 'outcome'];
export const RUNTIME_LOG_METRICS = [
  distribution('ops_action_operations', 'ops.action_outcome', 'operations', '1', ACTION_LABELS),
  distribution(
    'ops_action_messages',
    'ops.action_outcome',
    'confirmedMessages',
    '1',
    ACTION_LABELS,
  ),
  distribution(
    'ops_action_terminal_p50',
    'ops.action_outcome',
    'terminalP50Seconds',
    's',
    ACTION_LABELS,
  ),
  distribution(
    'ops_action_terminal_p95',
    'ops.action_outcome',
    'terminalP95Seconds',
    's',
    ACTION_LABELS,
  ),
  distribution('ops_action_pending', 'ops.action_pending', 'pending', '1', ['direction', 'verb']),
  distribution('ops_action_overdue', 'ops.action_pending', 'overdue', '1', ['direction', 'verb']),
  distribution('ops_action_pending_age', 'ops.action_pending', 'oldestPendingSeconds', 's', [
    'direction',
    'verb',
  ]),
  distribution('ops_action_failure', 'ops.action_failure', 'operations', '1', [
    'direction',
    'verb',
    'reason',
  ]),
  {
    name: 'ops_reconnect_email_outcome',
    description:
      'Reconnect email worker resolved outcomes. sent means provider accepted, not inbox delivery. Counts attempts; retries and skips are not recipients.',
    filter: `${WORKER} AND jsonPayload.kind="worker.succeeded" AND jsonPayload.worker="EmailSendWorker" AND jsonPayload.result.kind="gmail-reconnect" AND (${RECONNECT_EMAIL_OUTCOMES.map((outcome) => `jsonPayload.result.outcome="${outcome}"`).join(' OR ')})`,
    metricDescriptor: {
      metricKind: 'DELTA',
      valueType: 'INT64',
      unit: '1',
      labels: [{ key: 'outcome', valueType: 'STRING' }],
    },
    labelExtractors: { outcome: 'EXTRACT(jsonPayload.result.outcome)' },
  },

  distribution('ops_reconnect_incidents', 'ops.reconnect_lifecycle', 'incidents', '1', ['status']),
  distribution(
    'ops_reconnect_sync_after',
    'ops.reconnect_lifecycle',
    'followedBySuccessfulSync',
    '1',
    ['status'],
  ),
  distribution('ops_queue_wait_age', 'ops.queue_health', 'oldestWaitingAgeSeconds', 's', ['queue']),
  distribution('ops_queue_waiting', 'ops.queue_health', 'waiting', '1', ['queue']),
  distribution('ops_mailbox_affected', 'ops.mailbox_health', 'affectedMailboxes', '1', ['reason']),
  distribution('ops_scheduler_success_age', 'ops.scheduler_health', 'lastSuccessAgeSeconds', 's', [
    'worker',
  ]),
  distribution('ops_database_pressure', 'ops.database_health', 'utilizationRatio', '1'),
  distribution('ops_sync_attempt_duration', 'ops.sync_attempt', 'durationMs', 'ms', [
    'sync',
    'outcome',
  ]),
  distribution(
    'ops_initial_recovery_exhausted',
    'ops.initial_recovery_exhausted',
    'exhausted',
    '1',
  ),
  {
    name: 'ops_scheduler_no_success',
    description: 'Scheduler observations with no recorded successful run; missing is not zero age.',
    filter: `${WORKER} AND jsonPayload.kind="ops.scheduler_health" AND jsonPayload.successObserved=0`,
    metricDescriptor: {
      metricKind: 'DELTA',
      valueType: 'INT64',
      unit: '1',
      labels: [{ key: 'worker', valueType: 'STRING' }],
    },
    labelExtractors: { worker: 'EXTRACT(jsonPayload.worker)' },
  },
  {
    name: 'ops_collection_completed',
    description: 'Successful runtime collection observations; source and queue are bounded enums.',
    filter: `${WORKER} AND jsonPayload.kind="ops.collection" AND jsonPayload.success=1`,
    metricDescriptor: {
      metricKind: 'DELTA',
      valueType: 'INT64',
      unit: '1',
      labels: [
        { key: 'source', valueType: 'STRING' },
        { key: 'queue', valueType: 'STRING' },
      ],
    },
    labelExtractors: { source: 'EXTRACT(jsonPayload.source)', queue: 'EXTRACT(jsonPayload.queue)' },
  },
  {
    name: 'ops_collection_failed',
    description: 'Runtime collection failures; does not imply healthy zero counts.',
    filter: `${WORKER} AND jsonPayload.kind="ops.collection" AND jsonPayload.success=0`,
    metricDescriptor: {
      metricKind: 'DELTA',
      valueType: 'INT64',
      unit: '1',
      labels: [
        { key: 'source', valueType: 'STRING' },
        { key: 'queue', valueType: 'STRING' },
      ],
    },
    labelExtractors: { source: 'EXTRACT(jsonPayload.source)', queue: 'EXTRACT(jsonPayload.queue)' },
  },
];

export const OAUTH_FAILURE_REASONS = [
  'missing_state_cookie',
  'invalid_state_cookie',
  'invalid_state',
  'missing_code',
  'token_exchange_failed',
  'reconnect_failed',
  'reconnect_target_invalid',
  'reconnect_account_mismatch',
  'reconnect_gmail_scope_missing',
  'consent_failed',
  'orchestrator_failed',
  'sign_in_failed',
  'connect_session_invalid',
  'connect_failed',
  'gmail_scope_missing',
  'MAILBOX_OWNED_BY_OTHER_WORKSPACE',
];
/** Logged, but designed non-outages. Kept out of the failure metric. */
export const OAUTH_IGNORED_REASONS = [
  'consent_cancelled',
  'reconnect_cancelled',
  'INBOX_LIMIT_REACHED',
];
export const GMAIL_QUOTA_WORKERS = [
  'InitialSyncWorker',
  'IncrementalSyncWorker',
  'LabelActionWorker',
  'UnsubExecutionWorker',
  'AutopilotApplyWorker',
  'AutopilotActionWorker',
  'WatchRenewalWorker',
];
const API = 'resource.type="cloud_run_revision" AND resource.labels.service_name="declutrmail-api"';
const SECURITY = `${API} AND jsonPayload.kind="security_event"`;
function counter(name, description, filter, labels = []) {
  return {
    name,
    description,
    filter,
    metricDescriptor: {
      metricKind: 'DELTA',
      valueType: 'INT64',
      unit: '1',
      labels: labels.map((key) => ({ key, valueType: 'STRING' })),
    },
    ...(labels.length
      ? {
          labelExtractors: Object.fromEntries(
            labels.map((key) => [key, `EXTRACT(jsonPayload.${key})`]),
          ),
        }
      : {}),
  };
}
export const LAUNCH_LOG_METRICS = [
  counter(
    'oauth_callback_failure',
    'OAuth callback failures after a durable security_events insert. Designed cancellations and the inbox limit are excluded. Not a measured baseline.',
    `${SECURITY} AND jsonPayload.eventType="login.failure" AND (${OAUTH_FAILURE_REASONS.map((reason) => `jsonPayload.reason="${reason}"`).join(' OR ')})`,
  ),
  counter(
    'oauth_callback_start',
    'OAuth consent starts after a durable security_events insert.',
    `${SECURITY} AND jsonPayload.eventType="oauth.start"`,
  ),
  counter(
    'worker_dead_lettered',
    'New worker.dead_lettered terminals. Does not count repeated dead_letter.parked backlog lines.',
    `${WORKER} AND jsonPayload.kind="worker.dead_lettered"`,
    ['worker'],
  ),
  counter(
    'worker_oom_or_exit',
    'Worker container memory-limit or exit lines. API revisions are excluded.',
    `${WORKER} AND (textPayload:"Memory limit of" OR jsonPayload.message:"Memory limit of" OR ((textPayload:"Container called exit" OR jsonPayload.message:"Container called exit") AND NOT textPayload:"Container called exit(0)" AND NOT jsonPayload.message:"Container called exit(0)"))`,
  ),
  counter(
    'gmail_rate_limit_events',
    'RateLimitError on allowlisted Gmail workers. Initial guardrail, not a measured Gmail quota baseline. Domain icon lookups are excluded.',
    `${WORKER} AND jsonPayload.error="RateLimitError" AND jsonPayload.kind="worker.failed" AND (${GMAIL_QUOTA_WORKERS.map((worker) => `jsonPayload.worker="${worker}"`).join(' OR ')})`,
  ),
];

export const EXPECTED_RUNTIME_COLLECTIONS = [
  ...['mailbox', 'scheduler', 'database', 'reconnect', 'actions', 'recovery'].map((source) => ({
    source,
  })),
  ...['initial-sync', 'incremental-sync', 'email-send', 'snooze-wake'].map((queue) => ({
    source: 'queue',
    queue,
  })),
];
export function collectionKey({ source, queue }) {
  return source === 'queue' ? `${source}:${queue ?? ''}` : source;
}
