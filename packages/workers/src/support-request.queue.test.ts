import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import {
  SUPPORT_REQUEST_QUEUE,
  SupportRequestQueue,
  supportRequestJobOptions,
} from './support-request.queue.js';
import type { SupportRequestJobData } from './support-request.worker.js';

const payload: SupportRequestJobData = {
  subject: 'Synthetic queue test',
  message: 'A synthetic message that is never delivered.',
  replyTo: 'fixture@example.test',
  userId: 'fixture-user',
  workspaceId: 'fixture-workspace',
  submittedAt: '2026-09-22T00:00:00.000Z',
  idempotencyKey: `support-request__${'a'.repeat(64)}`,
};

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

async function rejectsWithoutWaiting(queue: SupportRequestQueue): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      queue
        .add(SUPPORT_REQUEST_QUEUE, payload, supportRequestJobOptions(payload.idempotencyKey))
        .then(
          () => 'accepted',
          () => 'rejected',
        ),
      new Promise<string>((resolve) => {
        timer = setTimeout(() => resolve('still waiting for Redis'), 250);
      }),
    ]);
    expect(result).toBe('rejected');
  } finally {
    clearTimeout(timer);
  }
}

describe('SupportRequestQueue connection readiness', () => {
  it('rejects before BullMQ waits for its first Redis connection', async () => {
    const queue = new SupportRequestQueue(`redis://127.0.0.1:${await unusedPort()}`);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await rejectsWithoutWaiting(queue);
    } finally {
      await queue.close();
      log.mockRestore();
    }
  });

  // This optional integration case owns an isolated, non-persistent loopback
  // Redis process. The startup rejection above runs without redis-server too.
  it.skipIf(spawnSync('redis-server', ['--version'], { stdio: 'ignore' }).status !== 0)(
    'recovers without enqueueing rejected submissions, then rejects a later outage',
    async () => {
      const port = await unusedPort();
      const queue = new SupportRequestQueue(`redis://127.0.0.1:${port}`);
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      let server: ReturnType<typeof spawn> | undefined;
      try {
        await rejectsWithoutWaiting(queue);
        server = spawn(
          'redis-server',
          ['--bind', '127.0.0.1', '--port', String(port), '--save', '', '--appendonly', 'no'],
          { stdio: 'ignore' },
        );
        await queue.waitUntilReady();
        expect(await queue.getJob(payload.idempotencyKey)).toBeUndefined();

        const accepted = await queue.add(
          SUPPORT_REQUEST_QUEUE,
          payload,
          supportRequestJobOptions(payload.idempotencyKey),
        );
        expect(await accepted.getState()).toBe('waiting');

        const disconnected = once(queue, 'ioredis:close');
        const exited = once(server, 'exit');
        server.kill('SIGTERM');
        await exited;
        await disconnected;
        await rejectsWithoutWaiting(queue);
      } finally {
        await queue.close();
        if (server && server.exitCode === null && server.signalCode === null) {
          const exited = once(server, 'exit');
          server.kill('SIGTERM');
          await exited;
        }
        log.mockRestore();
      }
    },
  );
});
