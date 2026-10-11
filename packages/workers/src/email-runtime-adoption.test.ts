import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { Queue, Worker } from 'bullmq';
import postgres from 'postgres';
import { expect, it } from 'vitest';
import {
  API_VALIDATION_START,
  advanceEmailRuntimeAdoption,
  attestEmailRuntimeAdoption,
  classifyEmailRuntimeHosting,
  emailRuntimeHostingDigest,
  verifySealedAdoptionWitness,
  type EmailRuntimeProcedureState,
} from './email-runtime-adoption.js';
import { adoptionEvidence, sealedWitness } from './email-runtime-adoption.fixture.js';
import {
  EmailRuntimeLease,
  createEmailRuntimeConnection,
  invalidateEmailRuntimeAdoption,
  readEmailRuntimeLeases,
} from './email-runtime-lease.js';
import { createRedisConnection } from './queue.js';

const SOURCE = 'a'.repeat(40);
const REVISION = 'declutrmail-worker-00164-synthetic';
const paused: EmailRuntimeProcedureState = {
  phase: 'paused',
  adoptionCertified: false,
  activationEnabled: false,
};

function refusal(run: () => unknown, detail: string): void {
  try {
    run();
    throw new Error(`expected ${detail}`);
  } catch (error) {
    expect(error).toMatchObject({ reason: 'runtime_adoption_unverified', detail });
  }
}

it('refuses worker-pool hosting instead of reading another revision variable', () => {
  expect(
    classifyEmailRuntimeHosting({
      K_SERVICE: 'declutrmail-worker',
      K_REVISION: REVISION,
    }),
  ).toEqual({ kind: 'cloud-run-service', service: 'declutrmail-worker', revision: REVISION });
  expect(classifyEmailRuntimeHosting({ CLOUD_RUN_WORKER_POOL: 'declutrmail-worker-pool' })).toEqual(
    { kind: 'unsupported', reason: 'worker_pool' },
  );
  expect(classifyEmailRuntimeHosting({ CLOUD_RUN_REVISION: REVISION })).toEqual({
    kind: 'unsupported',
    reason: 'worker_pool',
  });
  expect(
    classifyEmailRuntimeHosting({
      K_SERVICE: 'declutrmail-worker',
      K_REVISION: REVISION,
      CLOUD_RUN_WORKER_POOL: 'declutrmail-worker-pool',
    }),
  ).toEqual({ kind: 'unsupported', reason: 'mixed' });
  expect(classifyEmailRuntimeHosting({ K_REVISION: REVISION })).toEqual({
    kind: 'unsupported',
    reason: 'missing',
  });
  expect(
    classifyEmailRuntimeHosting({ K_SERVICE: 'declutrmail-worker', K_REVISION: 'not-a-revision' }),
  ).toEqual({ kind: 'unsupported', reason: 'malformed' });
  const worker = readFileSync(
    resolve(import.meta.dirname, '../../../apps/api/src/worker.ts'),
    'utf8',
  );
  const api = readFileSync(resolve(import.meta.dirname, '../../../apps/api/src/main.ts'), 'utf8');
  expect(worker).not.toContain("requireEnv('K_REVISION')");
  expect(worker).not.toContain('process.env.CLOUD_RUN_REVISION');
  expect(api).not.toContain('WORKER_ADMISSION_HELD');
  expect(api).not.toContain('EMAIL_RUNTIME_LEASE_ENABLED');
  expect(API_VALIDATION_START).toEqual({
    admissionHeldMode: false,
    bootstrapsProcessOnValidationBoot: true,
    writesPreferencesAtBoot: false,
    boundary: 'no-traffic-until-attested-worker-and-outbox',
  });
});

it('rejects caller booleans, unsupported retirement, and incomplete coverage', () => {
  const witness = sealedWitness({ source: SOURCE, workerRevision: REVISION });
  expect(verifySealedAdoptionWitness(witness, Date.now()).revisions).toEqual([
    { revision: REVISION, source: SOURCE },
  ]);
  refusal(
    () =>
      verifySealedAdoptionWitness(
        { inventoryComplete: true, retirementComplete: true },
        Date.now(),
      ),
    'caller_witness',
  );
  refusal(
    () => verifySealedAdoptionWitness({ ...witness, evidenceDigest: '0'.repeat(64) }, Date.now()),
    'witness_seal',
  );
  refusal(() => verifySealedAdoptionWitness(witness, Date.now() + 200_000), 'stale_evidence');
  for (const boundary of [
    'password-reset',
    'revision-metadata',
    'namespace-migration',
    'registry-absence',
  ] as const) {
    refusal(
      () => attestEmailRuntimeAdoption(adoptionEvidence({ boundary })),
      'retirement_boundary_unsupported',
    );
  }
  refusal(
    () =>
      attestEmailRuntimeAdoption(
        adoptionEvidence({
          mutate: (evidence) => {
            evidence.credentialHolders[0]!.coverage = 'denied';
          },
        }),
      ),
    'credential_coverage_denied',
  );
  refusal(
    () =>
      attestEmailRuntimeAdoption(
        adoptionEvidence({
          mutate: (evidence) => {
            evidence.credentialHolders[0]!.coverage = 'unavailable';
          },
        }),
      ),
    'credential_coverage_unavailable',
  );
  refusal(
    () =>
      attestEmailRuntimeAdoption(
        adoptionEvidence({
          mutate: (evidence) => {
            evidence.credentialHolders = [];
          },
        }),
      ),
    'incomplete_inventory',
  );
  refusal(
    () =>
      attestEmailRuntimeAdoption(
        adoptionEvidence({
          mutate: (evidence) => {
            evidence.credentialHolders[1]!.processRetired = 'unverified';
            evidence.credentialHolders[1]!.providerRevisionStatus = 'retired';
          },
        }),
      ),
    'retirement_unverified',
  );
  refusal(
    () =>
      attestEmailRuntimeAdoption(
        adoptionEvidence({
          mutate: (evidence) => {
            evidence.hostingAfter.workerObservedGeneration += 1;
          },
        }),
      ),
    'generation_drift',
  );
  refusal(
    () =>
      attestEmailRuntimeAdoption(
        adoptionEvidence({
          mutate: (evidence) => {
            evidence.hostingAfter = {
              ...evidence.hostingAfter,
              workerConfiguredGeneration: 172,
              workerObservedGeneration: 172,
            };
            evidence.observation.digestAfter = emailRuntimeHostingDigest(evidence.hostingAfter);
          },
        }),
      ),
    'observation_drift',
  );
  refusal(
    () =>
      attestEmailRuntimeAdoption(
        adoptionEvidence({
          mutate: (evidence) => {
            evidence.hostingBefore.workerAdmissionGuard = 'held';
          },
        }),
      ),
    'admission_held',
  );
  refusal(
    () =>
      attestEmailRuntimeAdoption(
        adoptionEvidence({
          mutate: (evidence) => {
            evidence.hostingBefore.apiAdmissionGuard = 'off';
          },
        }),
      ),
    'admission_guard_off',
  );
  refusal(
    () =>
      attestEmailRuntimeAdoption(
        adoptionEvidence({
          mutate: (evidence) => {
            evidence.workloads = evidence.workloads.filter(
              (row) => row.role !== 'api-preference-writer',
            );
          },
        }),
      ),
    'incomplete_inventory',
  );
  refusal(
    () =>
      attestEmailRuntimeAdoption(
        adoptionEvidence({
          mutate: (evidence) => {
            evidence.outstandingWork = 'pending';
          },
        }),
      ),
    'outstanding_work_unsettled',
  );
  refusal(
    () =>
      attestEmailRuntimeAdoption(
        adoptionEvidence({
          mutate: (evidence) => {
            evidence.probe.cleanedAfter = false;
          },
        }),
      ),
    'probe_unverified',
  );
});

it('keeps activation refused across held install, reopen, and rollback', () => {
  const witness = sealedWitness({ source: SOURCE, workerRevision: REVISION });
  refusal(() => advanceEmailRuntimeAdoption(paused, 'install-held', witness), 'admission_held');
  const held = advanceEmailRuntimeAdoption(paused, 'install-held');
  expect(held).toEqual({
    phase: 'worker-held',
    adoptionCertified: false,
    activationEnabled: false,
  });
  const ready = advanceEmailRuntimeAdoption(held, 'mark-ready', witness);
  expect(ready.adoptionCertified).toBe(true);
  expect(ready.activationEnabled).toBe(false);
  const opened = advanceEmailRuntimeAdoption(ready, 'reopen-api', witness);
  expect(opened.phase).toBe('api-open');
  expect(opened.activationEnabled).toBe(false);
  const rolled = advanceEmailRuntimeAdoption(opened, 'rollback', witness);
  expect(rolled).toEqual({
    phase: 'rolled-back',
    adoptionCertified: false,
    activationEnabled: false,
    invalidatedDigest: witness.evidenceDigest,
  });
  refusal(() => advanceEmailRuntimeAdoption(paused, 'reopen-api', witness), 'procedure');
});

it('rehearses adoption, recovery, and rollback on owned Redis, BullMQ, and Postgres', async () => {
  const pgUrl =
    process.env.OUTBOX_TEST_PG_URL ??
    'postgres://postgres:postgres@127.0.0.1:5432/declutrmail_outbox_test';
  const table = `adoption_fx_${randomUUID().replaceAll('-', '')}`;
  if (!/^adoption_fx_[a-f0-9]{32}$/.test(table)) throw new Error('Unsafe rehearsal table');
  const sql = postgres(pgUrl, { max: 1, idle_timeout: 1 });
  let redisUrl = process.env.TEST_REDIS_URL;
  let server: ReturnType<typeof spawn> | undefined;
  if (!redisUrl) {
    if (spawnSync('redis-server', ['--version'], { stdio: 'ignore' }).status !== 0)
      throw new Error('Adoption rehearsal needs TEST_REDIS_URL or redis-server');
    const listener = createServer();
    listener.listen(0, '127.0.0.1');
    await once(listener, 'listening');
    const address = listener.address();
    if (!address || typeof address === 'string') throw new Error('Missing rehearsal port');
    await new Promise<void>((resolveClose, reject) =>
      listener.close((error) => (error ? reject(error) : resolveClose())),
    );
    server = spawn(
      'redis-server',
      ['--bind', '127.0.0.1', '--port', String(address.port), '--save', '', '--appendonly', 'no'],
      { stdio: 'ignore' },
    );
    redisUrl = `redis://127.0.0.1:${address.port}`;
  }
  const prefix = `adoption-${randomUUID()}`;
  const connection = createRedisConnection(redisUrl);
  const admission = createEmailRuntimeConnection(redisUrl);
  const queue = new Queue('email-send', { connection, prefix });
  const rowId = randomUUID();
  try {
    await sql.unsafe(
      `create table ${table} (id uuid primary key, status text not null, attempts integer not null, job_id text not null)`,
    );
    await sql.unsafe(
      `insert into ${table} (id, status, attempts, job_id) values ($1, 'pending', 0, $2)`,
      [rowId, 'preserved-adoption'],
    );
    await connection.ping();
    await admission.connect();
    const held = advanceEmailRuntimeAdoption(paused, 'install-held');
    expect(held.adoptionCertified).toBe(false);
    expect(await admission.exists(`${prefix}:actors`)).toBe(0);

    const witness = sealedWitness({ source: SOURCE, workerRevision: REVISION });
    const lease = new EmailRuntimeLease(
      admission,
      { source: SOURCE, revision: REVISION },
      { prefix },
    );
    const deliveries: string[] = [];
    const worker = new Worker(
      'email-send',
      async (job) => {
        deliveries.push(String(job.id));
        return { ok: true };
      },
      { connection, prefix, autorun: false },
    );
    try {
      await worker.waitUntilReady();
      await lease.register();
      await lease.publish();
      const running = worker.run();
      void running.catch(() => undefined);
      await queue.add('synthetic', { ok: true }, { jobId: 'compatible-adoption', attempts: 3 });
      await viWait(async () => {
        expect(deliveries).toEqual(['compatible-adoption']);
      });
      expect((await queue.getJob('compatible-adoption'))?.attemptsMade).toBe(1);
      await expect(readEmailRuntimeLeases(admission, witness, prefix)).resolves.toEqual({
        workers: 1,
      });
      const ready = advanceEmailRuntimeAdoption(held, 'mark-ready', witness);
      const opened = advanceEmailRuntimeAdoption(ready, 'reopen-api', witness);
      expect(opened).toMatchObject({
        phase: 'api-open',
        adoptionCertified: true,
        activationEnabled: false,
      });
    } finally {
      await worker.close();
      await lease.release().catch(() => undefined);
    }
    await queue.add('synthetic', { preserved: true }, { jobId: 'preserved-adoption', attempts: 3 });
    const preserved = await queue.getJob('preserved-adoption');
    expect(preserved?.attemptsMade).toBe(0);
    expect(await preserved?.getState()).toBe('waiting');
    const [row] = await sql.unsafe(`select status, attempts, job_id from ${table} where id = $1`, [
      rowId,
    ]);
    expect(row).toEqual({ status: 'pending', attempts: 0, job_id: 'preserved-adoption' });
    const rolled = advanceEmailRuntimeAdoption(
      { phase: 'api-open', adoptionCertified: true, activationEnabled: false },
      'rollback',
      witness,
    );
    expect(rolled.adoptionCertified).toBe(false);
    expect(rolled.activationEnabled).toBe(false);
    await invalidateEmailRuntimeAdoption(admission, witness, prefix);
    await expect(readEmailRuntimeLeases(admission, witness, prefix)).rejects.toMatchObject({
      reason: 'runtime_adoption_unverified',
      detail: 'rollback_invalidated',
    });
    expect((await queue.getJob('preserved-adoption'))?.attemptsMade).toBe(0);
    expect(await (await queue.getJob('preserved-adoption'))?.getState()).toBe('waiting');
    const [after] = await sql.unsafe(`select status, attempts from ${table} where id = $1`, [
      rowId,
    ]);
    expect(after).toEqual({ status: 'pending', attempts: 0 });
  } finally {
    await sql.unsafe(`drop table if exists ${table}`);
    const [gone] = await sql.unsafe(`select to_regclass($1) as rel`, [`public.${table}`]);
    expect(gone?.rel).toBeNull();
    await queue.close();
    await admission.quit();
    connection.disconnect();
    await sql.end();
    server?.kill('SIGTERM');
  }
});

async function viWait(check: () => Promise<void>): Promise<void> {
  const deadline = Date.now() + 5_000;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      await check();
      return;
    } catch (error) {
      last = error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
    }
  }
  throw last;
}
