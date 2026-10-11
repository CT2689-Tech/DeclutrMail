import { pathToFileURL } from 'node:url';
import { Queue } from 'bullmq';
import {
  createRedisConnection,
  EMAIL_SEND_QUEUE,
  QueueActorCompatibilityError,
  readBillingQueueCompatibility,
  readEmailPrefsQueueCompatibility,
} from '@declutrmail/workers';

/**
 * Task exit codes. The deploy reads only this number from the Cloud Run task,
 * so every failure must map to a fixed reason and never carry provider text.
 */
export const PROBE_EXIT_CODES = {
  unclassified: 1,
  configuration_unavailable: 10,
  redis_never_ready: 11,
  redis_network_error: 12,
  redis_tls_error: 13,
  redis_reply_error: 14,
  broker_read_stalled: 15,
  client_list_unavailable: 16,
  no_workers: 17,
  incompatible_workers: 18,
} as const;
export type ProbeFailureReason = keyof typeof PROBE_EXIT_CODES;

export class BillingQueueProbeError extends Error {
  constructor(
    message: string,
    readonly reason: ProbeFailureReason,
  ) {
    super(message);
  }
}

const NETWORK_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
]);

/** Classifies a connection error by its fixed name/code; its message is never read. */
function redisErrorReason(error: unknown): ProbeFailureReason | undefined {
  const { name, code } = (error ?? {}) as { name?: unknown; code?: unknown };
  if (name === 'ReplyError') return 'redis_reply_error';
  if (typeof code !== 'string') return undefined;
  if (NETWORK_CODES.has(code)) return 'redis_network_error';
  if (/^(?:ERR_TLS_|ERR_SSL_|CERT_|UNABLE_TO_|DEPTH_ZERO_|SELF_SIGNED_)/.test(code))
    return 'redis_tls_error';
  return undefined;
}

export function probeFailureReason(error: unknown): ProbeFailureReason {
  if (error instanceof BillingQueueProbeError || error instanceof QueueActorCompatibilityError)
    return error.reason;
  return 'unclassified';
}

/** Standalone private diagnostic; never imports the API/worker bootstrap. */
export async function verifyBillingQueue(): Promise<{ workers: number }> {
  if (process.env.BILLING_NOTICE_PROBE !== 'true' || !process.env.BILLING_NOTICE_REDIS_URL)
    throw new BillingQueueProbeError(
      'Billing queue probe configuration unavailable',
      'configuration_unavailable',
    );
  let connection: ReturnType<typeof createRedisConnection> | undefined;
  let queue: Queue | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastRedisError: ProbeFailureReason | undefined;
  try {
    connection = createRedisConnection(process.env.BILLING_NOTICE_REDIS_URL);
    connection.on('error', (error: unknown) => {
      lastRedisError = redisErrorReason(error) ?? lastRedisError;
    });
    queue = new Queue(EMAIL_SEND_QUEUE, { connection, skipMetasUpdate: true });
    queue.on('error', () => {});
    const redis = connection;
    return await Promise.race([
      Promise.all([
        readBillingQueueCompatibility(queue),
        readEmailPrefsQueueCompatibility(queue),
      ]).then(([, prefs]) => prefs),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new BillingQueueProbeError(
                'Billing queue probe deadline',
                redis.status === 'ready'
                  ? 'broker_read_stalled'
                  : (lastRedisError ?? 'redis_never_ready'),
              ),
            ),
          25_000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    connection?.disconnect();
    await queue?.close().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const proof = await verifyBillingQueue();
    console.log(
      JSON.stringify({
        billingQueueCompatible: true,
        emailPrefsCompatible: true,
        workers: proof.workers,
      }),
    );
  } catch (error) {
    const reason = probeFailureReason(error);
    console.error(JSON.stringify({ billingQueueProbe: { reason } }));
    console.error('Billing queue compatibility unverified; no producer deployment');
    process.exitCode = PROBE_EXIT_CODES[reason];
  }
}
