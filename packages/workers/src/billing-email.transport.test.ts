import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { expect, it, vi } from 'vitest';
import { createRedisConnection } from './queue.js';
import {
  BILLING_EMAIL_SEND_QUEUE,
  BILLING_QUEUE_COMPATIBLE_WORKER_NAME,
  EMAIL_PREFS_COMPATIBLE_WORKER_NAME,
  readEmailPrefsQueueCompatibility,
  EMAIL_SEND_QUEUE,
  createBillingEmailSendConsumer,
  enqueueEmailSend,
  readBillingQueueCompatibility,
  QueueActorCompatibilityError,
  sampleEmailQueueCompatibility,
} from './email-send.queue.js';
import type { EmailSendJobData, EmailSendResult } from './email-send.worker.js';

/** CI provides TEST_REDIS_URL; local runs own an ephemeral Redis server. */
async function ownedRedis(): Promise<{ url: string; stop: () => Promise<void> }> {
  // Never use application REDIS_URL. A unique prefix owns every key cleaned here.
  let redisUrl = process.env.TEST_REDIS_URL;
  let server: ReturnType<typeof spawn> | undefined;
  if (redisUrl) {
    const target = new URL(redisUrl);
    if (target.protocol !== 'redis:' || !['127.0.0.1', 'localhost'].includes(target.hostname))
      throw new Error('Billing transport requires a local test Redis');
  } else {
    if (spawnSync('redis-server', ['--version'], { stdio: 'ignore' }).status !== 0)
      throw new Error('Billing transport needs TEST_REDIS_URL or the Redis test executable');
    const listener = createServer();
    listener.listen(0, '127.0.0.1');
    await once(listener, 'listening');
    const address = listener.address();
    if (!address || typeof address === 'string') throw new Error('Missing local test port');
    await new Promise<void>((resolve, reject) =>
      listener.close((error) => (error ? reject(error) : resolve())),
    );
    server = spawn(
      'redis-server',
      ['--bind', '127.0.0.1', '--port', String(address.port), '--save', '', '--appendonly', 'no'],
      { stdio: 'ignore' },
    );
    await once(server, 'spawn');
    redisUrl = `redis://127.0.0.1:${address.port}`;
  }
  const owned = server;
  return {
    url: redisUrl,
    stop: async () => {
      if (owned && owned.exitCode === null && owned.signalCode === null) {
        const exited = once(owned, 'exit');
        owned.kill('SIGTERM');
        await exited;
      }
    },
  };
}

it('preserves waiting billing jobs while OFF and isolates them from a live legacy consumer', async () => {
  const redis = await ownedRedis();
  const redisUrl = redis.url;
  const prefix = `billing-transport-${randomUUID()}`;
  const connection = createRedisConnection(redisUrl);
  const billing = new Queue<EmailSendJobData>(BILLING_EMAIL_SEND_QUEUE, { connection, prefix });
  const generic = new Queue<EmailSendJobData>(EMAIL_SEND_QUEUE, { connection, prefix });
  const oldProcessor = vi.fn().mockResolvedValue({ outcome: 'sent' });
  const legacy = new Worker(EMAIL_SEND_QUEUE, oldProcessor, { connection, prefix, concurrency: 1 });
  const processor = vi.fn().mockResolvedValue({
    outcome: 'sent',
    kind: 'billing-lifecycle',
    providerId: 'synthetic',
  } satisfies EmailSendResult);
  let consumer: Worker<EmailSendJobData, EmailSendResult> | null = null;
  let compatibleLegacy: Worker | undefined;
  let futureCompatible: Worker | undefined;
  try {
    await Promise.all([
      billing.waitUntilReady(),
      generic.waitUntilReady(),
      legacy.waitUntilReady(),
    ]);
    const payload: EmailSendJobData = {
      kind: 'billing-lifecycle',
      userId: 'synthetic-user',
      subject: 'Synthetic transport control',
      text: 'No provider email is sent.',
      idempotencyKey: 'email__billing__synthetic-transport',
    };
    expect(createBillingEmailSendConsumer(false, processor, { connection, prefix })).toBeNull();
    await enqueueEmailSend(billing, payload);
    const decoyCompleted = once(legacy, 'completed');
    await generic.add('synthetic-decoy', { ...payload, kind: 'sync-complete' });
    await decoyCompleted;
    const waiting = await billing.getJob(payload.idempotencyKey);
    expect(await waiting!.getState()).toBe('waiting');
    expect(waiting!.attemptsMade).toBe(0);
    expect(await billing.getWorkers()).toHaveLength(0);
    expect(processor).not.toHaveBeenCalled();
    expect(oldProcessor).toHaveBeenCalledTimes(1);
    expect(oldProcessor.mock.calls[0]![0].data.kind).toBe('sync-complete');
    await expect(readBillingQueueCompatibility(generic)).rejects.toThrow(
      'compatibility unverified',
    );
    await expect(readBillingQueueCompatibility(generic)).rejects.toMatchObject({
      reason: 'incompatible_workers',
    });
    const empty = new Queue(EMAIL_SEND_QUEUE, { connection, prefix: `${prefix}-empty` });
    try {
      const refusal = await readEmailPrefsQueueCompatibility(empty).catch((e: unknown) => e);
      expect(refusal).toBeInstanceOf(QueueActorCompatibilityError);
      expect(refusal).toMatchObject({ reason: 'no_workers' });
    } finally {
      await empty.close();
    }
    compatibleLegacy = new Worker(EMAIL_SEND_QUEUE, oldProcessor, {
      connection,
      prefix,
      concurrency: 1,
      name: BILLING_QUEUE_COMPATIBLE_WORKER_NAME,
    });
    await compatibleLegacy.waitUntilReady();
    await expect(readBillingQueueCompatibility(generic)).rejects.toThrow(
      'compatibility unverified',
    );
    await legacy.close();
    expect(await readBillingQueueCompatibility(generic)).toEqual({ workers: 1 });
    await expect(readEmailPrefsQueueCompatibility(generic)).rejects.toThrow(
      'compatibility unverified',
    );
    futureCompatible = new Worker(EMAIL_SEND_QUEUE, oldProcessor, {
      connection,
      prefix,
      concurrency: 1,
      name: EMAIL_PREFS_COMPATIBLE_WORKER_NAME,
    });
    await futureCompatible.waitUntilReady();
    await expect(readEmailPrefsQueueCompatibility(generic)).rejects.toThrow(
      'compatibility unverified',
    );
    await expect(readEmailPrefsQueueCompatibility(generic)).rejects.toMatchObject({
      reason: 'incompatible_workers',
    });
    await compatibleLegacy.close();
    expect(await readEmailPrefsQueueCompatibility(generic)).toEqual({ workers: 1 });
    expect(await readBillingQueueCompatibility(generic)).toEqual({ workers: 1 });
    consumer = createBillingEmailSendConsumer(true, processor, {
      connection,
      prefix,
      concurrency: 1,
    });
    const completed = once(consumer!, 'completed');
    await consumer!.waitUntilReady();
    const [job, result] = await completed;
    expect(job.id).toBe(payload.idempotencyKey);
    expect(result).toMatchObject({ outcome: 'sent', kind: 'billing-lifecycle' });
    expect(processor).toHaveBeenCalledTimes(1);
    expect(oldProcessor).toHaveBeenCalledTimes(1);
  } finally {
    await consumer?.close();
    await legacy.close();
    await compatibleLegacy?.close();
    await futureCompatible?.close();
    await Promise.all([billing.obliterate({ force: true }), generic.obliterate({ force: true })]);
    await Promise.all([billing.close(), generic.close()]);
    connection.disconnect();
    await redis.stop();
  }
}, 15000);

it('finds a live worker whose named connection is momentarily reconnecting', async () => {
  const redis = await ownedRedis();
  const prefix = `actor-window-${randomUUID()}`;
  // A slow reconnect holds the worker's named blocking connection absent long
  // enough to observe, as a broker idle-close or proxy reset would.
  const workerConnection = new Redis(redis.url, {
    maxRetriesPerRequest: null,
    retryStrategy: () => 1_000,
  });
  const admin = createRedisConnection(redis.url);
  const worker = new Worker(EMAIL_SEND_QUEUE, async () => ({}), {
    connection: workerConnection,
    prefix,
    name: EMAIL_PREFS_COMPATIBLE_WORKER_NAME,
  });
  worker.on('error', () => {});
  const generic = new Queue(EMAIL_SEND_QUEUE, { connection: admin, prefix });
  const withQueue = async <T>(read: (queue: Queue) => Promise<T>) => {
    const queue = new Queue(EMAIL_SEND_QUEUE, { connection: admin, prefix });
    try {
      return await read(queue);
    } finally {
      await queue.close();
    }
  };
  try {
    await worker.waitUntilReady();
    expect(await readEmailPrefsQueueCompatibility(generic)).toEqual({ workers: 1 });
    const [named] = await generic.getWorkers();
    await admin.client('KILL', 'ID', named!.id!);
    await expect(readEmailPrefsQueueCompatibility(generic)).rejects.toMatchObject({
      reason: 'no_workers',
    });
    const sampled = await sampleEmailQueueCompatibility(withQueue, {
      samples: 4,
      intervalMs: 700,
    }).catch((error: unknown) => error);
    // Closing a worker mid-reconnect hangs, so let it return before asserting.
    await vi.waitFor(async () => expect(await generic.getWorkers()).toHaveLength(1), {
      timeout: 5_000,
    });
    expect(sampled).toEqual({ workers: 1 });
  } finally {
    await worker.close();
    workerConnection.disconnect();
    await generic.close();
    admin.disconnect();
    await redis.stop();
  }
}, 15000);
