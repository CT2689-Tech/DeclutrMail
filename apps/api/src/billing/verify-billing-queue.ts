import { pathToFileURL } from 'node:url';
import { Queue } from 'bullmq';
import {
  createRedisConnection,
  EMAIL_SEND_QUEUE,
  QueueActorCompatibilityError,
  sampleEmailQueueCompatibility,
} from '@declutrmail/workers';

type Redis = ReturnType<typeof createRedisConnection>;

/**
 * Fresh broker connection per sample, so neither a worker that is momentarily
 * reconnecting nor this probe's own connection placement decides the verdict.
 * Startup plus the deadline must stay inside the task's 60 s timeout.
 */
export const PROBE_SAMPLING = { samples: 5, intervalMs: 3_000 };
export const PROBE_DEADLINE_MS = 35_000;

/**
 * Task exit codes. The deploy reads only this number from the Cloud Run task,
 * so every failure must map to a fixed reason and never carry provider text.
 */
export const PROBE_EXIT_CODES = {
  unclassified: 1,
  configuration_unavailable: 101,
  redis_not_ready: 102,
  redis_network_error: 103,
  redis_tls_error: 104,
  redis_reply_error: 105,
  broker_read_stalled: 106,
  client_list_unavailable: 107,
  no_workers: 108,
  incompatible_workers: 109,
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
  return redisErrorReason(error) ?? 'unclassified';
}

/** Standalone private diagnostic; never imports the API/worker bootstrap. */
export async function verifyBillingQueue(): Promise<{ workers: number }> {
  if (process.env.BILLING_NOTICE_PROBE !== 'true' || !process.env.BILLING_NOTICE_REDIS_URL)
    throw new BillingQueueProbeError(
      'Billing queue probe configuration unavailable',
      'configuration_unavailable',
    );
  const redisUrl = process.env.BILLING_NOTICE_REDIS_URL;
  type Handle = { connection: Redis; queue?: Queue; error?: ProbeFailureReason | undefined };
  const open = new Set<Handle>();
  let current: Handle | undefined;
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const release = async (handle: Handle) => {
    open.delete(handle);
    if (current === handle) current = undefined;
    handle.connection.disconnect();
    await handle.queue?.close().catch(() => {});
  };
  const withQueue = async <T>(read: (queue: Queue) => Promise<T>): Promise<T> => {
    if (finished) throw new BillingQueueProbeError('Billing queue probe deadline', 'unclassified');
    const handle: Handle = { connection: createRedisConnection(redisUrl) };
    open.add(handle);
    current = handle;
    handle.connection.on('error', (error: unknown) => {
      handle.error = redisErrorReason(error) ?? handle.error;
    });
    try {
      handle.queue = new Queue(EMAIL_SEND_QUEUE, {
        connection: handle.connection,
        skipMetasUpdate: true,
      });
      handle.queue.on('error', () => {});
      return await read(handle.queue);
    } finally {
      await release(handle);
    }
  };
  /** Between samples every read so far was answered, so the broker is slow, not unreachable. */
  const deadlineReason = (): ProbeFailureReason =>
    !current || current.connection.status === 'ready'
      ? 'broker_read_stalled'
      : (current.error ?? 'redis_not_ready');
  try {
    return await Promise.race([
      sampleEmailQueueCompatibility(withQueue, PROBE_SAMPLING),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(new BillingQueueProbeError('Billing queue probe deadline', deadlineReason())),
          PROBE_DEADLINE_MS,
        );
      }),
    ]);
  } finally {
    finished = true;
    clearTimeout(timer);
    await Promise.all([...open].map(release));
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
