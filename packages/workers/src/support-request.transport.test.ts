import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { expect, it, vi } from 'vitest';
import { createRedisConnection } from './queue.js';
import {
  SUPPORT_REQUEST_QUEUE,
  SupportRequestQueue,
  supportRequestJobOptions,
} from './support-request.queue.js';
import { SupportRequestWorker, type SupportRequestJobData } from './support-request.worker.js';

async function unusedPort(): Promise<number> {
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const address = listener.address();
  if (!address || typeof address === 'string') throw new Error('Missing test listener');
  await new Promise<void>((resolve, reject) => {
    listener.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

// No env URL, application database, mailbox, or email provider is used. Redis is
// owned by this test, bound to an ephemeral loopback port, with persistence off.
it.skipIf(spawnSync('redis-server', ['--version'], { stdio: 'ignore' }).status !== 0)(
  'delivers a real queued support job through run(), emits success, and removes its payload',
  async () => {
    const port = await unusedPort();
    const server = spawn(
      'redis-server',
      ['--bind', '127.0.0.1', '--port', String(port), '--save', '', '--appendonly', 'no'],
      { stdio: 'ignore' },
    );
    const url = `redis://127.0.0.1:${port}`;
    const producer = new SupportRequestQueue(url);
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let connection: Redis | undefined;
    let consumer: Worker<SupportRequestJobData, { providerAccepted: true }> | undefined;
    try {
      await producer.waitUntilReady();
      const payload: SupportRequestJobData = {
        subject: 'Synthetic worker smoke',
        message: 'Private synthetic support text for the transport test.',
        replyTo: 'authenticated-fixture@example.test',
        userId: 'fixture-user',
        workspaceId: 'fixture-workspace',
        submittedAt: '2026-09-22T00:00:00.000Z',
        idempotencyKey: `support-request__${'b'.repeat(64)}`,
      };
      const deliver = vi.fn().mockResolvedValue({ ok: true, providerId: 'fake-provider-id' });
      const worker = new SupportRequestWorker({ deliver });
      const observer = {
        captureFailure: vi.fn(),
        captureBackgroundFailure: vi.fn(),
        recordBackgroundNotice: vi.fn(),
      };
      worker.setObserver(observer);
      connection = createRedisConnection(url);
      consumer = new Worker<SupportRequestJobData, { providerAccepted: true }>(
        SUPPORT_REQUEST_QUEUE,
        (job) => worker.run(job),
        { connection, concurrency: 1 },
      );
      const workerErrors = vi.fn();
      consumer.on('error', workerErrors);
      await consumer.waitUntilReady();
      const completed = once(consumer, 'completed');

      const enqueued = await producer.add(
        SUPPORT_REQUEST_QUEUE,
        payload,
        supportRequestJobOptions(payload.idempotencyKey),
      );
      const [completedJob, result] = await completed;
      expect(completedJob.id).toBe(enqueued.id);
      expect(result).toEqual({ providerAccepted: true });
      expect(deliver).toHaveBeenCalledTimes(1);
      const delivery = deliver.mock.calls[0]![0];
      expect(delivery.to).toBe('support@declutrmail.com');
      expect(delivery.replyTo).toBe(payload.replyTo);
      expect(delivery.idempotencyKey).toBe(payload.idempotencyKey);
      expect(delivery.text.includes(payload.message)).toBe(true);
      expect(delivery.text.includes(payload.workspaceId)).toBe(true);
      expect(observer.captureFailure).not.toHaveBeenCalled();
      expect(observer.captureBackgroundFailure).not.toHaveBeenCalled();
      expect(workerErrors).not.toHaveBeenCalled();

      // Success is the base worker's structured lifecycle event; its observer
      // port is failure-only. Assert both the event and real BullMQ completion.
      const events = logs.mock.calls.map(([line]) => JSON.parse(String(line)));
      expect(events.map((event) => event.kind)).toEqual(['worker.started', 'worker.succeeded']);
      expect(events[1]).toMatchObject({
        kind: 'worker.succeeded',
        worker: 'SupportRequestWorker',
        attempt: 1,
      });
      const capturedLogs = JSON.stringify([
        ...logs.mock.calls,
        ...errors.mock.calls,
        ...warnings.mock.calls,
      ]);
      for (const privateValue of [payload.subject, payload.message, payload.replyTo]) {
        expect(capturedLogs.includes(privateValue)).toBe(false);
      }

      expect(await producer.getJob(payload.idempotencyKey)).toBeUndefined();
      expect(await connection.hget(producer.toKey(payload.idempotencyKey), 'data')).toBeNull();
    } finally {
      await consumer?.close();
      connection?.disconnect();
      await producer.close();
      if (server.exitCode === null && server.signalCode === null) {
        const exited = once(server, 'exit');
        server.kill('SIGTERM');
        await exited;
      }
      logs.mockRestore();
      errors.mockRestore();
      warnings.mockRestore();
    }
  },
);
