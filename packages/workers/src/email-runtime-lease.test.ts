import { freshTestPglite } from '@declutrmail/db/testing';
import { schema, users, workspaces } from '@declutrmail/db';
import { drizzle } from 'drizzle-orm/pglite';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { EmailSendWorker } from './email-send.worker.js';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { Queue, Worker } from 'bullmq';
import { expect, it, vi } from 'vitest';
import {
  EmailRuntimeGuard,
  startEmailRuntimeConsumer,
  finishEmailRuntimeStartup,
} from './email-runtime-guard.js';
import type {
  EmailSendJobData,
  EmailSendResult,
  EmailDeliveryOutcome,
} from './email-send.worker.js';
import { createBillingEmailSendConsumer, enqueueEmailSend } from './email-send.queue.js';
import { createRedisConnection } from './queue.js';
import {
  createEmailRuntimeConnection,
  EmailRuntimeLease,
  readEmailRuntimeLeases,
  type EmailRuntimeAdoptionWitness,
} from './email-runtime-lease.js';

const SOURCE = 'a'.repeat(40);
const REVISION = 'declutrmail-worker-00164-synthetic';
function witness(): EmailRuntimeAdoptionWitness {
  return {
    inventoryComplete: true,
    retirementComplete: true,
    requestDrainComplete: true,
    leaseEnforcementComplete: true,
    billingConsumerRequired: false,
    validUntil: Date.now() + 60_000,
    revisions: [{ revision: REVISION, source: SOURCE }],
  };
}

async function fixture(
  run: (f: {
    connection: ReturnType<typeof createRedisConnection>;
    admission: ReturnType<typeof createEmailRuntimeConnection>;
    prefix: string;
  }) => Promise<void>,
) {
  let url = process.env.TEST_REDIS_URL;
  let server: ReturnType<typeof spawn> | undefined;
  if (url) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'redis:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname))
      throw new Error('Lease test requires an owned loopback Redis');
  } else {
    if (spawnSync('redis-server', ['--version'], { stdio: 'ignore' }).status !== 0)
      throw new Error('Lease test needs loopback TEST_REDIS_URL or redis-server');
    const listener = createServer();
    listener.listen(0, '127.0.0.1');
    await once(listener, 'listening');
    const address = listener.address();
    if (!address || typeof address === 'string') throw new Error('Missing test port');
    await new Promise<void>((resolve, reject) =>
      listener.close((e) => (e ? reject(e) : resolve())),
    );
    server = spawn(
      'redis-server',
      ['--bind', '127.0.0.1', '--port', String(address.port), '--save', '', '--appendonly', 'no'],
      { stdio: 'ignore' },
    );
    url = `redis://127.0.0.1:${address.port}`;
  }
  const prefix = `runtime-lease-${randomUUID()}`;
  const connection = createRedisConnection(url);
  const admission = createEmailRuntimeConnection(url);
  try {
    await connection.ping(); // The owned ephemeral server must finish starting.
    await admission.connect();
    await run({ connection, admission, prefix });
  } finally {
    admission.disconnect();
    // Only the unique fixture keys; never flush shared local test Redis.
    const keys = await connection.keys(`${prefix}*`);
    if (keys.length) await connection.del(...keys);
    await connection.quit();
    if (server) {
      const stopped = once(server, 'exit');
      server.kill('SIGTERM');
      await stopped;
    }
  }
}

it('proves real ready consumers from global keys even when CLIENT LIST omits them', async () => {
  await fixture(async ({ connection, admission, prefix }) => {
    const queue = new Queue('email-send', { connection, prefix });
    const processor = vi.fn(async () => ({ synthetic: true }));
    const worker = new Worker('email-send', processor, { connection, prefix, autorun: false });
    const lease = new EmailRuntimeLease(
      admission,
      { source: SOURCE, revision: REVISION },
      { prefix },
    );
    try {
      await queue.add('synthetic', {}, { jobId: 'preserved', attempts: 3 });
      await worker.waitUntilReady();
      await lease.register();
      // Reproduced source assumption: discovery sees no worker. The new reader
      // must never consult either connection's client inventory.
      const list = vi.spyOn(admission, 'client').mockRejectedValue(new Error('fragmented'));
      await expect(readEmailRuntimeLeases(admission, witness(), prefix)).rejects.toMatchObject({
        reason: 'no_workers',
      });
      expect(list).not.toHaveBeenCalled();
      const completed = once(worker, 'completed');
      await startEmailRuntimeConsumer(worker, lease, async () => {});
      await lease.publish();
      await expect(readEmailRuntimeLeases(admission, witness(), prefix)).resolves.toEqual({
        workers: 1,
      });
      await completed;
      expect(processor).toHaveBeenCalledOnce();
      expect((await queue.getJob('preserved'))?.attemptsMade).toBe(1);
      list.mockRestore();
    } finally {
      await worker.close();
      await lease.release();
      await queue.close();
    }
  });
});

it('a beacon or preference-compatible source without adoption cannot clear the gate', async () => {
  await fixture(async ({ admission, prefix }) => {
    await admission.set(`${prefix}:unrelated-heartbeat`, 'compatible');
    await expect(readEmailRuntimeLeases(admission, witness(), prefix)).rejects.toMatchObject({
      reason: 'no_workers',
    });
    const lease = new EmailRuntimeLease(
      admission,
      { source: SOURCE, revision: REVISION },
      { prefix },
    );
    await lease.register();
    for (const field of [
      'inventoryComplete',
      'retirementComplete',
      'requestDrainComplete',
      'leaseEnforcementComplete',
    ] as const) {
      await expect(
        readEmailRuntimeLeases(admission, { ...witness(), [field]: false }, prefix),
      ).rejects.toMatchObject({ reason: 'runtime_adoption_unverified' });
    }
    await lease.release();
  });
});

it('revoked or expired admission cannot renew itself or silently regain processing', async () => {
  await fixture(async ({ admission, prefix }) => {
    const lease = new EmailRuntimeLease(
      admission,
      { source: SOURCE, revision: REVISION },
      { prefix },
    );
    await lease.register();
    await lease.assertAdmission();
    const record = JSON.parse((await admission.hget(`${prefix}:actors`, lease.bootId))!);
    record.expiresAt = 1;
    await admission.hset(`${prefix}:actors`, lease.bootId, JSON.stringify(record));
    await expect(lease.assertAdmission()).rejects.toMatchObject({ reason: 'lease_lost' });
    await expect(lease.renew()).rejects.toMatchObject({ reason: 'lease_lost' });
    await expect(readEmailRuntimeLeases(admission, witness(), prefix)).rejects.toMatchObject({
      reason: 'runtime_settlement_unverified',
    });
    await lease.release();
  });
});

it('refuses mixed, unmapped and malformed actors including expired unknown protocols', async () => {
  await fixture(async ({ admission, prefix }) => {
    const lease = new EmailRuntimeLease(
      admission,
      { source: SOURCE, revision: REVISION },
      { prefix },
    );
    await lease.register();
    const key = `${prefix}:actors`;
    const id = randomUUID();
    const compatible = JSON.parse((await admission.hget(key, lease.bootId))!);
    for (const record of [
      { ...compatible, protocol: 'legacy', expiresAt: 1 },
      { ...compatible, source: 'b'.repeat(40) },
      { ...compatible, revision: 'unexpected-worker' },
    ]) {
      await admission.hset(key, id, JSON.stringify(record));
      await expect(readEmailRuntimeLeases(admission, witness(), prefix)).rejects.toMatchObject({
        reason: 'incompatible_workers',
      });
    }
    await admission.hset(key, id, 'invalid');
    await expect(readEmailRuntimeLeases(admission, witness(), prefix)).rejects.toMatchObject({
      reason: 'runtime_registry_malformed',
    });
    await admission.hdel(key, id);
    await lease.release();
  });
});

const PAYLOAD: EmailSendJobData = {
  kind: 'sync-complete',
  userId: 'synthetic',
  subject: 'synthetic',
  text: 'synthetic',
  idempotencyKey: 'synthetic-idempotency',
};

it('actual lease refusal delays the existing job without consuming its retry budget', async () => {
  await fixture(async ({ connection, admission, prefix }) => {
    const queue = new Queue<EmailSendJobData, EmailSendResult>('email-send', {
      connection,
      prefix,
    });
    const lease = new EmailRuntimeLease(
      admission,
      { source: SOURCE, revision: REVISION },
      { prefix },
    );
    const port = { deliver: vi.fn(async () => ({ ok: true as const, providerId: null })) };
    const guard = new EmailRuntimeGuard(lease, port);
    const processor = vi.fn(async () => ({
      outcome: 'sent' as const,
      kind: PAYLOAD.kind,
      providerId: null,
    }));
    const worker = new Worker<EmailSendJobData, EmailSendResult>(
      'email-send',
      (job) => guard.run(job, processor),
      { connection, prefix, autorun: false },
    );
    try {
      await worker.waitUntilReady();
      await lease.register();
      await queue.add('synthetic', PAYLOAD, { jobId: 'preserved', attempts: 3 });
      const own = JSON.parse((await admission.hget(lease.key, lease.bootId))!);
      await admission.hset(lease.key, lease.bootId, JSON.stringify({ ...own, expiresAt: 1 }));
      void worker.run();
      await vi.waitFor(async () =>
        expect(await (await queue.getJob('preserved'))?.getState()).toBe('delayed'),
      );
      const job = await queue.getJob('preserved');
      expect(job?.attemptsMade).toBe(0);
      expect(job?.opts.attempts).toBe(3);
      expect(job?.id).toBe('preserved');
      expect(processor).not.toHaveBeenCalled();
      expect(port.deliver).not.toHaveBeenCalled();
    } finally {
      await worker.close();
      await lease.release();
      await queue.close();
    }
  });
});

it('cached acceptance retries acknowledgement without another external send', async () => {
  await fixture(async ({ connection, admission, prefix }) => {
    const queue = new Queue<EmailSendJobData, EmailSendResult>('email-send', {
      connection,
      prefix,
    });
    const lease = new EmailRuntimeLease(
      admission,
      { source: SOURCE, revision: REVISION },
      { prefix },
    );
    const port = {
      deliver: vi.fn(async () => ({ ok: true as const, providerId: 'synthetic-accepted' })),
    };
    const guard = new EmailRuntimeGuard(lease, port);
    const worker = new Worker<EmailSendJobData, EmailSendResult>(
      'email-send',
      (job) =>
        guard.run(job, async () => {
          await guard.assertDeliveryAdmission({
            jobId: job.id!,
            workerName: 'test',
            attempt: 1,
            maxAttempts: 2,
            startedAt: new Date(),
            policy: 'batchPolicy',
          });
          const result = await guard.delivery.deliver({
            to: 'synthetic@example.invalid',
            subject: PAYLOAD.subject,
            text: PAYLOAD.text,
            idempotencyKey: PAYLOAD.idempotencyKey,
          });
          if (job.attemptsMade === 0) throw new Error('synthetic acknowledgement failure');
          if (!result.ok) throw new Error('unexpected synthetic outcome');
          return { outcome: 'sent', kind: PAYLOAD.kind, providerId: result.providerId };
        }),
      { connection, prefix, autorun: false },
    );
    try {
      await worker.waitUntilReady();
      await lease.register();
      await queue.add('synthetic', PAYLOAD, { jobId: 'preserved', attempts: 2 });
      const completed = once(worker, 'completed');
      void worker.run();
      await completed;
      expect(port.deliver).toHaveBeenCalledOnce();
      expect((await queue.getJob('preserved'))?.returnvalue.providerId).toBe('synthetic-accepted');
    } finally {
      await worker.close();
      await guard.drain();
      await lease.release();
      await queue.close();
    }
  });
});

it('unknown provider acceptance remains held across retry with exact job history', async () => {
  await fixture(async ({ connection, admission, prefix }) => {
    const queue = new Queue<EmailSendJobData, EmailSendResult>('email-send', {
      connection,
      prefix,
    });
    const lease = new EmailRuntimeLease(
      admission,
      { source: SOURCE, revision: REVISION },
      { prefix },
    );
    const port = {
      deliver: vi.fn(async () => {
        throw new Error('synthetic accepted response lost');
      }),
    };
    const guard = new EmailRuntimeGuard(lease, port);
    const worker = new Worker<EmailSendJobData, EmailSendResult>(
      'email-send',
      (job) =>
        guard.run(job, async () => {
          await guard.assertDeliveryAdmission({
            jobId: job.id!,
            workerName: 'test',
            attempt: 1,
            maxAttempts: 2,
            startedAt: new Date(),
            policy: 'batchPolicy',
          });
          await guard.delivery.deliver({
            to: 'synthetic@example.invalid',
            subject: PAYLOAD.subject,
            text: PAYLOAD.text,
            idempotencyKey: PAYLOAD.idempotencyKey,
          });
          return { outcome: 'sent', kind: PAYLOAD.kind, providerId: null };
        }),
      { connection, prefix, autorun: false },
    );
    try {
      await worker.waitUntilReady();
      await lease.register();
      await queue.add('synthetic', PAYLOAD, { jobId: 'preserved', attempts: 2 });
      void worker.run();
      await vi.waitFor(async () =>
        expect(await (await queue.getJob('preserved'))?.getState()).toBe('failed'),
      );
      expect(port.deliver).toHaveBeenCalledOnce();
      const job = await queue.getJob('preserved');
      expect(job?.attemptsMade).toBe(2);
      expect(job?.id).toBe('preserved');
      expect(
        JSON.parse(
          (await admission.hget(`${job?.queueQualifiedName}:preserved`, 'emailRuntimeDeliveryV1'))!,
        ),
      ).toMatchObject({ state: 'unknown' });
    } finally {
      await worker.close();
      await guard.drain();
      await lease.release();
      await queue.close();
    }
  });
});

it('fresh enrollment cannot hide an expired actor or remove another identity', async () => {
  await fixture(async ({ admission, prefix }) => {
    const old = new EmailRuntimeLease(
      admission,
      { source: SOURCE, revision: REVISION },
      { prefix },
    );
    await old.register();
    const record = JSON.parse((await admission.hget(old.key, old.bootId))!);
    await admission.hset(old.key, old.bootId, JSON.stringify({ ...record, expiresAt: 1 }));
    const fresh = new EmailRuntimeLease(
      admission,
      { source: SOURCE, revision: REVISION },
      { prefix },
    );
    await fresh.register();
    await expect(fresh.assertAdmission()).rejects.toMatchObject({ reason: 'lease_lost' });
    await expect(readEmailRuntimeLeases(admission, witness(), prefix)).rejects.toMatchObject({
      reason: 'runtime_settlement_unverified',
    });
    await admission.hset(
      old.key,
      old.bootId,
      JSON.stringify({ ...record, source: 'b'.repeat(40) }),
    );
    await expect(old.release()).rejects.toMatchObject({ reason: 'runtime_registry_malformed' });
    expect(await admission.hexists(old.key, old.bootId)).toBe(1);
    await fresh.release();
  });
});

it('pre-delivery lease loss preserves attempts even after rendering finished', async () => {
  await fixture(async ({ connection, admission, prefix }) => {
    const queue = new Queue<EmailSendJobData, EmailSendResult>('email-send', {
      connection,
      prefix,
    });
    const lease = new EmailRuntimeLease(
      admission,
      { source: SOURCE, revision: REVISION },
      { prefix },
    );
    const port = { deliver: vi.fn(async () => ({ ok: true as const, providerId: null })) };
    const guard = new EmailRuntimeGuard(lease, port);
    const worker = new Worker<EmailSendJobData, EmailSendResult>(
      'email-send',
      (job) =>
        guard.run(job, async () => {
          const record = JSON.parse((await admission.hget(lease.key, lease.bootId))!);
          await admission.hset(
            lease.key,
            lease.bootId,
            JSON.stringify({ ...record, expiresAt: 1 }),
          );
          await guard.assertDeliveryAdmission({
            jobId: job.id!,
            workerName: 'test',
            attempt: 1,
            maxAttempts: 2,
            startedAt: new Date(),
            policy: 'batchPolicy',
          });
          await guard.delivery.deliver({
            to: 'synthetic@example.invalid',
            subject: PAYLOAD.subject,
            text: PAYLOAD.text,
            idempotencyKey: PAYLOAD.idempotencyKey,
          });
          return { outcome: 'sent', kind: PAYLOAD.kind, providerId: null };
        }),
      { connection, prefix, autorun: false },
    );
    try {
      await worker.waitUntilReady();
      await lease.register();
      await queue.add('synthetic', PAYLOAD, { jobId: 'preserved', attempts: 2 });
      void worker.run();
      await vi.waitFor(async () =>
        expect(await (await queue.getJob('preserved'))?.getState()).toBe('delayed'),
      );
      expect((await queue.getJob('preserved'))?.attemptsMade).toBe(0);
      expect(port.deliver).not.toHaveBeenCalled();
    } finally {
      await worker.close();
      await guard.drain();
      await lease.release();
      await queue.close();
    }
  });
});

it('dedup retains accepted or unknown evidence even when a later attempt completed as skipped', async () => {
  await fixture(async ({ connection, admission, prefix }) => {
    const queue = new Queue<EmailSendJobData, EmailSendResult>('email-send', {
      connection,
      prefix,
    });
    const lease = new EmailRuntimeLease(
      admission,
      { source: SOURCE, revision: REVISION },
      { prefix },
    );
    const guard = new EmailRuntimeGuard(lease, {
      deliver: async () => ({ ok: true, providerId: null }),
    });
    const worker = new Worker<EmailSendJobData, EmailSendResult>(
      'email-send',
      (job) =>
        guard.run(job, async () => {
          await guard.delivery.deliver({
            to: 'synthetic@example.invalid',
            subject: PAYLOAD.subject,
            text: PAYLOAD.text,
            idempotencyKey: PAYLOAD.idempotencyKey,
          });
          return { outcome: 'skipped_opted_out', kind: PAYLOAD.kind, providerId: null };
        }),
      { connection, prefix, autorun: false },
    );
    try {
      await worker.waitUntilReady();
      await lease.register();
      await queue.add('synthetic', PAYLOAD, { jobId: PAYLOAD.idempotencyKey, attempts: 2 });
      const completed = once(worker, 'completed');
      void worker.run();
      await completed;
      expect(await enqueueEmailSend(queue, PAYLOAD)).toBe('noop');
      await admission.hset(
        queue.toKey(PAYLOAD.idempotencyKey),
        'emailRuntimeDeliveryV1',
        JSON.stringify({ state: 'unknown' }),
      );
      expect(await enqueueEmailSend(queue, PAYLOAD)).toBe('noop');
      expect((await queue.getJob(PAYLOAD.idempotencyKey))?.returnvalue.outcome).toBe(
        'skipped_opted_out',
      );
    } finally {
      await worker.close();
      await guard.drain();
      await lease.release();
      await queue.close();
    }
  });
});

it('drain waits for real external I/O after a processor deadline abandons its wait', async () => {
  await fixture(async ({ connection, admission, prefix }) => {
    const queue = new Queue<EmailSendJobData, EmailSendResult>('email-send', {
      connection,
      prefix,
    });
    const lease = new EmailRuntimeLease(
      admission,
      { source: SOURCE, revision: REVISION },
      { prefix },
    );
    let sendStarted!: () => void;
    const started = new Promise<void>((r) => {
      sendStarted = r;
    });
    let settle!: () => void;
    const actualIo = new Promise<void>((r) => {
      settle = r;
    });
    const guard = new EmailRuntimeGuard(lease, {
      deliver: async () => {
        sendStarted();
        await actualIo;
        return { ok: true, providerId: null };
      },
    });
    const worker = new Worker<EmailSendJobData, EmailSendResult>(
      'email-send',
      (job) =>
        guard.run(job, async () => {
          // The real port call outlives its processor, exactly like Base's deadline.
          void guard.delivery
            .deliver({
              to: 'synthetic@example.invalid',
              subject: PAYLOAD.subject,
              text: PAYLOAD.text,
              idempotencyKey: PAYLOAD.idempotencyKey,
            })
            .catch(() => {});
          await started;
          throw new Error('synthetic processor deadline');
        }),
      { connection, prefix, autorun: false },
    );
    try {
      await worker.waitUntilReady();
      await lease.register();
      await queue.add('synthetic', PAYLOAD, { jobId: 'preserved', attempts: 1 });
      void worker.run();
      await started;
      await worker.close();
      let drained = false;
      const drain = guard.drain().then(() => {
        drained = true;
      });
      await new Promise((r) => setTimeout(r, 20));
      expect(drained).toBe(false);
      expect(await admission.hexists(lease.key, lease.bootId)).toBe(1);
      settle();
      await drain;
      expect(drained).toBe(true);
      await lease.release();
      expect(
        JSON.parse((await admission.hget(queue.toKey('preserved'), 'emailRuntimeDeliveryV1'))!),
      ).toMatchObject({ state: 'accepted' });
    } finally {
      settle();
      await worker.close();
      await guard.drain();
      await queue.close();
    }
  });
});

it('actual polling rejection invalidates capability even with a live renewer', async () => {
  await fixture(async ({ connection, admission, prefix }) => {
    // Missing processor is BullMQ's real run() rejection, not a forged beacon.
    const worker = new Worker<EmailSendJobData, EmailSendResult>('email-send', undefined, {
      connection,
      prefix,
      autorun: false,
    });
    const lease = new EmailRuntimeLease(
      admission,
      { source: SOURCE, revision: REVISION },
      { prefix, ttlMs: 1000 },
    );
    let stopped!: () => void;
    const settled = new Promise<void>((r) => {
      stopped = r;
    });
    try {
      await worker.waitUntilReady();
      await lease.register();
      lease.startRenewing(async () => {});
      lease.observePolling(worker.run(), async () => {
        stopped();
      });
      await settled;
      expect(lease.isActive).toBe(false);
      await expect(lease.assertAdmission()).rejects.toMatchObject({ reason: 'lease_lost' });
      await expect(readEmailRuntimeLeases(admission, witness(), prefix)).rejects.toMatchObject({
        reason: 'runtime_settlement_unverified',
      });
      await new Promise((r) => setTimeout(r, 360));
      expect(JSON.parse((await admission.hget(lease.key, lease.bootId))!).expiresAt).toBe(0);
    } finally {
      await worker.close();
      await lease.release();
    }
  });
});

it('lost BEGIN response before provider invocation preserves the exact retry budget', async () => {
  await fixture(async ({ connection, admission, prefix }) => {
    const queue = new Queue<EmailSendJobData, EmailSendResult>('email-send', {
      connection,
      prefix,
    });
    const lease = new EmailRuntimeLease(
      admission,
      { source: SOURCE, revision: REVISION },
      { prefix },
    );
    const port = { deliver: vi.fn(async () => ({ ok: true as const, providerId: null })) };
    const guard = new EmailRuntimeGuard(lease, port);
    const original = admission.eval.bind(admission);
    let injected = false;
    const fault = vi
      .spyOn(admission, 'eval')
      .mockImplementation(async (...args: Parameters<typeof admission.eval>) => {
        const value = await original(...args);
        if (!injected && String(args[0]).includes("return {'begin'")) {
          injected = true;
          throw new Error('synthetic BEGIN response lost');
        }
        return value;
      });
    const worker = new Worker<EmailSendJobData, EmailSendResult>(
      'email-send',
      (job) =>
        guard.run(job, async () => {
          await guard.delivery.deliver({
            to: 'synthetic@example.invalid',
            subject: PAYLOAD.subject,
            text: PAYLOAD.text,
            idempotencyKey: PAYLOAD.idempotencyKey,
          });
          return { outcome: 'sent', kind: PAYLOAD.kind, providerId: null };
        }),
      { connection, prefix, autorun: false },
    );
    try {
      await worker.waitUntilReady();
      await lease.register();
      await queue.add('synthetic', PAYLOAD, { jobId: 'preserved', attempts: 3 });
      void worker.run();
      await vi.waitFor(async () =>
        expect(await (await queue.getJob('preserved'))?.getState()).toBe('delayed'),
      );
      expect(injected).toBe(true);
      expect(port.deliver).not.toHaveBeenCalled();
      expect((await queue.getJob('preserved'))?.attemptsMade).toBe(0);
      expect(await admission.hexists(queue.toKey('preserved'), 'emailRuntimeDeliveryV1')).toBe(0);
    } finally {
      fault.mockRestore();
      await worker.close();
      await guard.drain();
      await lease.release();
      await queue.close();
    }
  });
});

it('deferred admission cannot overwrite an intervening polling-loss health state', async () => {
  await fixture(async ({ admission, prefix }) => {
    const lease = new EmailRuntimeLease(
      admission,
      { source: SOURCE, revision: REVISION },
      { prefix },
    );
    await lease.register();
    let failed = false;
    let release!: () => void;
    const admissionWait = new Promise<void>((r) => {
      release = r;
    });
    const pending = vi.spyOn(lease, 'assertAdmission').mockImplementation(() => admissionWait);
    const ready = vi.fn();
    const startup = finishEmailRuntimeStartup(lease, () => !failed, ready);
    const refusal = expect(startup).rejects.toThrow('readiness lost');
    failed = true;
    release();
    await refusal;
    expect(ready).not.toHaveBeenCalled();
    pending.mockRestore();
    await lease.release();
  });
});

it('an API actor or flag-OFF worker cannot satisfy required billing consumer readiness', async () => {
  await fixture(async ({ connection, admission, prefix }) => {
    expect(
      () =>
        new EmailRuntimeLease(
          admission,
          { source: SOURCE, revision: 'declutrmail-api-00620-test' },
          { prefix },
        ),
    ).toThrow();
    const generic = new Worker('email-send', async () => ({ synthetic: true }), {
      connection,
      prefix,
      autorun: false,
    });
    const off = new EmailRuntimeLease(
      admission,
      { source: SOURCE, revision: REVISION },
      { prefix },
    );
    try {
      await generic.waitUntilReady();
      await off.register();
      await startEmailRuntimeConsumer(generic, off, async () => {});
      await off.publish();
      await expect(
        readEmailRuntimeLeases(admission, { ...witness(), billingConsumerRequired: true }, prefix),
      ).rejects.toMatchObject({ reason: 'no_workers' });
    } finally {
      await generic.close();
      await off.release();
    }
    const billing = createBillingEmailSendConsumer(
      true,
      async () => ({ outcome: 'sent', kind: 'sync-complete', providerId: null }),
      { connection, prefix, autorun: false },
    )!;
    const on = new EmailRuntimeLease(
      admission,
      { source: SOURCE, revision: REVISION },
      { prefix, billingConsumer: true },
    );
    try {
      await billing.waitUntilReady();
      await on.register();
      await startEmailRuntimeConsumer(billing, on, async () => {});
      await on.publish();
      await expect(
        readEmailRuntimeLeases(admission, { ...witness(), billingConsumerRequired: true }, prefix),
      ).resolves.toEqual({ workers: 1 });
    } finally {
      await billing.close();
      await on.release();
    }
  });
});

it('local revoke during a successful but deferred BEGIN response prevents the actual send', async () => {
  await fixture(async ({ connection, admission, prefix }) => {
    const queue = new Queue<EmailSendJobData, EmailSendResult>('email-send', {
      connection,
      prefix,
    });
    const lease = new EmailRuntimeLease(
      admission,
      { source: SOURCE, revision: REVISION },
      { prefix },
    );
    const port = { deliver: vi.fn(async () => ({ ok: true as const, providerId: null })) };
    const guard = new EmailRuntimeGuard(lease, port);
    let begun!: () => void;
    const begin = new Promise<void>((r) => {
      begun = r;
    });
    let release!: () => void;
    const held = new Promise<void>((r) => {
      release = r;
    });
    const original = admission.eval.bind(admission);
    const fault = vi
      .spyOn(admission, 'eval')
      .mockImplementation(async (...args: Parameters<typeof admission.eval>) => {
        const value = await original(...args);
        if (String(args[0]).includes("return {'begin'")) {
          begun();
          await held;
        }
        return value;
      });
    const worker = new Worker<EmailSendJobData, EmailSendResult>(
      'email-send',
      (job) =>
        guard.run(job, async () => {
          await guard.delivery.deliver({
            to: 'synthetic@example.invalid',
            subject: PAYLOAD.subject,
            text: PAYLOAD.text,
            idempotencyKey: PAYLOAD.idempotencyKey,
          });
          return { outcome: 'sent', kind: PAYLOAD.kind, providerId: null };
        }),
      { connection, prefix, autorun: false },
    );
    try {
      await worker.waitUntilReady();
      await lease.register();
      await queue.add('synthetic', PAYLOAD, { jobId: 'preserved', attempts: 3 });
      void worker.run();
      await begin;
      await lease.invalidate();
      release();
      await vi.waitFor(async () =>
        expect(await (await queue.getJob('preserved'))?.getState()).toBe('delayed'),
      );
      expect(port.deliver).not.toHaveBeenCalled();
      expect((await queue.getJob('preserved'))?.attemptsMade).toBe(0);
    } finally {
      release();
      fault.mockRestore();
      await worker.close();
      await guard.drain();
      await lease.release();
      await queue.close();
    }
  });
});

it('real EmailSendWorker records ambiguous delivery as retained failure before a later preference skip', async () => {
  const pg = await freshTestPglite();
  const db = drizzle(pg, { schema });
  try {
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: 'Synthetic runtime' })
      .returning();
    const [user] = await db
      .insert(users)
      .values({ workspaceId: workspace!.id, email: 'synthetic@example.invalid' })
      .returning();
    await fixture(async ({ connection, admission, prefix }) => {
      const queue = new Queue<EmailSendJobData, EmailSendResult>('email-send', {
        connection,
        prefix,
      });
      const lease = new EmailRuntimeLease(
        admission,
        { source: SOURCE, revision: REVISION },
        { prefix },
      );
      let ambiguous = true;
      const port = {
        deliver: vi.fn(async (): Promise<EmailDeliveryOutcome> =>
          ambiguous
            ? { ok: false, reason: 'transient', detail: 'synthetic uncertain acceptance' }
            : { ok: true, providerId: 'synthetic-confirmed' },
        ),
      };
      const guard = new EmailRuntimeGuard(lease, port);
      const email = new EmailSendWorker({
        db: db as unknown as PostgresJsDatabase<typeof schema>,
        delivery: guard.delivery,
        assertDeliveryAdmission: guard.assertDeliveryAdmission,
        classifyDeliveryFailure: guard.classifyDeliveryFailure,
      });
      const worker = new Worker<EmailSendJobData, EmailSendResult>(
        'email-send',
        (job) => guard.run(job, () => email.run(job)),
        { connection, prefix, autorun: false },
      );
      const payload = { ...PAYLOAD, userId: user!.id };
      try {
        await worker.waitUntilReady();
        await lease.register();
        await queue.add('synthetic', payload, {
          jobId: PAYLOAD.idempotencyKey,
          attempts: 3,
          removeOnFail: false,
          removeOnComplete: { age: 7 * 86400 },
        });
        await startEmailRuntimeConsumer(worker, lease, async () => {});
        await lease.publish();
        await vi.waitFor(async () =>
          expect(await (await queue.getJob(PAYLOAD.idempotencyKey))?.getState()).toBe('failed'),
        );
        const first = await queue.getJob(PAYLOAD.idempotencyKey);
        expect(first?.attemptsMade).toBe(1);
        expect(first?.opts.removeOnFail).toBe(false);
        expect(port.deliver).toHaveBeenCalledOnce();
        await db
          .update(users)
          .set({ preferences: { emailPrefs: { syncComplete: false } } })
          .where(eq(users.id, user!.id));
        await first!.retry();
        await vi.waitFor(async () => {
          const job = await queue.getJob(PAYLOAD.idempotencyKey);
          expect(await job?.getState()).toBe('failed');
          expect(job?.attemptsMade).toBe(2);
        });
        expect(port.deliver).toHaveBeenCalledOnce();
        expect((await queue.getJob(PAYLOAD.idempotencyKey))?.returnvalue).toBeNull();
        expect(await enqueueEmailSend(queue, payload)).toBe('noop');
        ambiguous = false;
        await db
          .update(users)
          .set({ preferences: { emailPrefs: { syncComplete: true } } })
          .where(eq(users.id, user!.id));
        const confirmed = { ...payload, idempotencyKey: 'synthetic-confirmed-event' };
        const completed = once(worker, 'completed');
        await queue.add('synthetic', confirmed, {
          jobId: confirmed.idempotencyKey,
          attempts: 3,
          removeOnFail: false,
        });
        await completed;
        expect((await queue.getJob(confirmed.idempotencyKey))?.returnvalue.outcome).toBe('sent');
        expect(port.deliver).toHaveBeenCalledTimes(2);
      } finally {
        await worker.close();
        await guard.drain();
        await lease.release();
        await queue.close();
      }
    });
  } finally {
    await pg.close();
  }
});

it('busy shutdown immediately fences admission and keeps its hold until real work settles', async () => {
  await fixture(async ({ connection, admission, prefix }) => {
    const queue = new Queue<EmailSendJobData, EmailSendResult>('email-send', {
      connection,
      prefix,
    });
    const lease = new EmailRuntimeLease(
      admission,
      { source: SOURCE, revision: REVISION },
      { prefix },
    );
    let started!: () => void;
    const sendStarted = new Promise<void>((r) => {
      started = r;
    });
    let settle!: () => void;
    const io = new Promise<void>((r) => {
      settle = r;
    });
    const guard = new EmailRuntimeGuard(lease, {
      deliver: async () => {
        started();
        await io;
        return { ok: true, providerId: null };
      },
    });
    const worker = new Worker<EmailSendJobData, EmailSendResult>(
      'email-send',
      (job) =>
        guard.run(job, async () => {
          await guard.delivery.deliver({
            to: 'synthetic@example.invalid',
            subject: PAYLOAD.subject,
            text: PAYLOAD.text,
            idempotencyKey: PAYLOAD.idempotencyKey,
          });
          return { outcome: 'sent', kind: PAYLOAD.kind, providerId: null };
        }),
      { connection, prefix, autorun: false },
    );
    try {
      await worker.waitUntilReady();
      await lease.register();
      await queue.add('synthetic', PAYLOAD, { jobId: 'preserved', attempts: 3 });
      await startEmailRuntimeConsumer(worker, lease, async () => {});
      await lease.publish();
      lease.startRenewing(async () => {});
      await sendStarted;
      await expect(readEmailRuntimeLeases(admission, witness(), prefix)).resolves.toEqual({
        workers: 1,
      });
      const revoke = lease.invalidate();
      expect(lease.isActive).toBe(false);
      let closed = false;
      const closing = worker.close().then(() => {
        closed = true;
      });
      await revoke;
      await expect(readEmailRuntimeLeases(admission, witness(), prefix)).rejects.toMatchObject({
        reason: 'runtime_settlement_unverified',
      });
      await new Promise((r) => setTimeout(r, 20));
      expect(closed).toBe(false);
      expect(await admission.hexists(lease.key, lease.bootId)).toBe(1);
      settle();
      await closing;
      await guard.drain();
      await lease.release();
      expect(await admission.hexists(lease.key, lease.bootId)).toBe(0);
    } finally {
      settle();
      await worker.close();
      await guard.drain();
      await queue.close();
    }
  });
});
