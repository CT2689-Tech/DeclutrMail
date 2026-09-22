import { Queue, type JobsOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import { createRedisProducerConnection } from './queue.js';
import type { SupportRequestJobData } from './support-request.worker.js';
import { WORKER_POLICIES } from './worker-policies.js';
export const SUPPORT_REQUEST_QUEUE = 'support-request';

/** Request-path producer: reject before BullMQ can wait for initial Redis readiness. */
export class SupportRequestQueue extends Queue<SupportRequestJobData> {
  private initialized = false;
  private readonly producerConnection: Redis;

  constructor(redisUrl: string) {
    const connection = createRedisProducerConnection(redisUrl);
    super(SUPPORT_REQUEST_QUEUE, { connection });
    this.producerConnection = connection;
    // No request data is captured by this background connection attempt.
    void this.waitUntilReady().then(
      () => {
        this.initialized = true;
      },
      () => {
        this.initialized = false;
      },
    );
    this.on('error', () => {
      console.error(JSON.stringify({ level: 'error', kind: 'support_queue.connection_error' }));
    });
  }

  override async add(...args: Parameters<Queue<SupportRequestJobData>['add']>) {
    // enableOfflineQueue=false only guards commands, not BullMQ's initial
    // waitUntilReady promise. Never enter add() until both layers are ready.
    if (this.closing || !this.initialized || this.producerConnection.status !== 'ready') {
      throw new Error('Support queue unavailable');
    }
    return super.add(...args);
  }

  override async close(): Promise<void> {
    try {
      await super.close();
    } finally {
      // BullMQ treats a supplied connection as shared; this producer owns it.
      this.producerConnection.disconnect();
    }
  }

  /** Nest lifecycle hook for the API's factory-provided queue. */
  async onModuleDestroy(): Promise<void> {
    await this.close();
  }
}

export function supportRequestJobOptions(idempotencyKey: string): JobsOptions {
  const policy = WORKER_POLICIES.batchPolicy;
  return {
    jobId: idempotencyKey,
    attempts: policy.maxAttempts,
    backoff: { type: 'exponential', delay: policy.backoff.delayMs },
    // BullMQ retention is lazy (pruned when subsequent jobs finish), not a TTL.
    removeOnComplete: true,
    removeOnFail: { age: 7 * 86400, count: 1000 },
  };
}
