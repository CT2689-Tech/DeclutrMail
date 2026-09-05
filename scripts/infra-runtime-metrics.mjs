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
export const RUNTIME_LOG_METRICS = [
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

export const EXPECTED_RUNTIME_COLLECTIONS = [
  ...['mailbox', 'scheduler', 'database', 'reconnect'].map((source) => ({ source })),
  ...['initial-sync', 'incremental-sync', 'email-send', 'snooze-wake'].map((queue) => ({
    source: 'queue',
    queue,
  })),
];
export function collectionKey({ source, queue }) {
  return source === 'queue' ? `${source}:${queue ?? ''}` : source;
}
