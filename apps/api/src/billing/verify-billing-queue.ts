import { pathToFileURL } from 'node:url';
import { createRedisConnection, readEmailRuntimeLeases } from '@declutrmail/workers';

type Redis = ReturnType<typeof createRedisConnection>;

/**
 * Task exit codes. The deploy reads only this number from the Cloud Run task,
 * so every failure must map to a fixed reason and never carry provider text.
 * `client_list_unavailable` remains so historical tasks keep their recorded
 * reason. This probe does not list broker clients.
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
  adoption_unverified: 110,
  settlement_unverified: 111,
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

const LEASE_REASONS: Record<string, ProbeFailureReason> = {
  runtime_adoption_unverified: 'adoption_unverified',
  no_workers: 'no_workers',
  incompatible_workers: 'incompatible_workers',
  runtime_settlement_unverified: 'settlement_unverified',
  client_list_unavailable: 'client_list_unavailable',
};

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

function leaseReason(error: unknown): ProbeFailureReason | undefined {
  if (!error || typeof error !== 'object' || !('reason' in error)) return undefined;
  const reason = (error as { reason: unknown }).reason;
  return typeof reason === 'string' ? LEASE_REASONS[reason] : undefined;
}

export function probeFailureReason(error: unknown): ProbeFailureReason {
  if (error instanceof BillingQueueProbeError) return error.reason;
  return leaseReason(error) ?? redisErrorReason(error) ?? 'unclassified';
}

/** Standalone private diagnostic. It does not list broker clients and never
 * accepts an environment-supplied witness. Missing adoption evidence fails closed.
 */
export async function verifyBillingQueue(): Promise<never> {
  if (process.env.BILLING_NOTICE_PROBE !== 'true' || !process.env.BILLING_NOTICE_REDIS_URL)
    throw new BillingQueueProbeError(
      'Billing queue probe configuration unavailable',
      'configuration_unavailable',
    );
  if (process.env.EMAIL_RUNTIME_ADOPTION_WITNESS || process.env.CLIENT_LIST_COMPATIBLE)
    throw new BillingQueueProbeError('Billing queue adoption unverified', 'adoption_unverified');
  const connection: Redis = createRedisConnection(process.env.BILLING_NOTICE_REDIS_URL);
  connection.on('error', () => undefined);
  try {
    await connection.ping();
    await readEmailRuntimeLeases(connection, undefined);
    throw new BillingQueueProbeError('Billing queue adoption unverified', 'adoption_unverified');
  } catch (error) {
    if (error instanceof BillingQueueProbeError) throw error;
    const redis = redisErrorReason(error);
    if (redis) throw new BillingQueueProbeError('Billing queue probe redis unverified', redis);
    const lease = leaseReason(error);
    if (lease) throw new BillingQueueProbeError('Billing queue adoption unverified', lease);
    throw new BillingQueueProbeError('Billing queue adoption unverified', 'unclassified');
  } finally {
    connection.disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await verifyBillingQueue();
  } catch (error) {
    const reason = probeFailureReason(error);
    console.error(JSON.stringify({ billingQueueProbe: { reason } }));
    console.error('Billing queue compatibility unverified; no producer deployment');
    process.exitCode = PROBE_EXIT_CODES[reason];
  }
}
