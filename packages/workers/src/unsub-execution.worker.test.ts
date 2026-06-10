import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import {
  actionJobs,
  activityLog,
  mailboxAccounts,
  outboxEvents,
  schema,
  senderPolicies,
  senders,
  users,
  workspaces,
} from '@declutrmail/db';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { OutboxPublisher } from './outbox-publisher.js';
import {
  buildPinnedLookup,
  classifyAddress,
  UNSUB_MAX_ATTEMPTS,
  UnsubExecutionWorker,
  unsubExecutionJobOptions,
} from './unsub-execution.worker.js';
import type { UnsubHttpPort } from './unsub-execution.worker.js';
import { TransientError } from './worker-errors.js';
import type { WorkerContext } from './worker-context.js';

/**
 * UnsubExecutionWorker tests (D9 Wave 2) — fake HTTP layer ONLY. No
 * test in this file (or any other) ever performs a real outbound
 * unsubscribe call; the `UnsubHttpPort` seam is the guarantee.
 *
 * Covers: 2xx / 3xx / 4xx / 5xx classification, the one-network-retry
 * budget, SSRF rejections (https-only, private/link-local/loopback),
 * the insecure-targets flag gating (incl. its production hard-refusal),
 * idempotent replay, the method≠one_click invariant, and D58 (the
 * outcome row never carries an undo token).
 */

const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'db', 'migrations');

type Db = ReturnType<typeof drizzle<typeof schema>>;

/**
 * ONE migrated PGlite for the whole file. Replaying every migration
 * takes seconds per call, so a per-test (let alone per-loop-iteration)
 * rebuild blows vitest's 30s budget under load. Tests isolate via
 * `resetDb` (TRUNCATE) in `beforeEach` instead.
 */
async function migratedDb(): Promise<Db> {
  const pg = new PGlite({ extensions: { citext } });
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const migrationSql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of migrationSql.split('--> statement-breakpoint')) {
      const trimmed = stmt.trim();
      if (trimmed) {
        await pg.query(trimmed);
      }
    }
  }
  return drizzle(pg, { schema });
}

/**
 * Wipe every table this file touches (CASCADE catches FK dependents).
 * No migration seeds reference rows (0022's backfill INSERT selects
 * from `senders`, empty on a fresh DB), so TRUNCATE ≡ fresh schema.
 */
async function resetDb(db: Db): Promise<void> {
  await db.execute(
    sql`TRUNCATE workspaces, users, mailbox_accounts, senders, sender_policies, action_jobs, activity_log, outbox_events CASCADE`,
  );
}

const SENDER_KEY = 'b'.repeat(64);

async function seedMailbox(db: Db): Promise<string> {
  const [ws] = await db.insert(workspaces).values({ name: 'WS' }).returning({ id: workspaces.id });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: ws!.id, email: 'owner@declutrmail.ai' })
    .returning({ id: users.id });
  const [mailbox] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId: ws!.id,
      userId: user!.id,
      provider: 'gmail',
      providerAccountId: 'owner@declutrmail.ai',
    })
    .returning({ id: mailboxAccounts.id });
  return mailbox!.id;
}

async function seedSender(
  db: Db,
  mailboxAccountId: string,
  args: {
    method?: 'one_click' | 'mailto' | 'none' | null;
    url?: string | null;
  } = {},
): Promise<void> {
  await db.insert(senders).values({
    mailboxAccountId,
    senderKey: SENDER_KEY,
    email: 'news@shop.example',
    domain: 'shop.example',
    gmailCategory: 'promotions',
    firstSeenAt: new Date('2026-01-01'),
    lastSeenAt: new Date('2026-05-01'),
    unsubscribeMethod: args.method === undefined ? 'one_click' : args.method,
    unsubscribeUrl: args.url === undefined ? 'https://unsub.shop.example/oneclick?u=42' : args.url,
  });
}

/** The pending policy row the intent path upserts before enqueue. */
async function seedPendingPolicy(db: Db, mailboxAccountId: string): Promise<void> {
  await db.insert(senderPolicies).values({
    mailboxAccountId,
    senderKey: SENDER_KEY,
    policyType: 'unsubscribe',
    unsubStatus: 'pending',
  });
}

async function seedExecutionJob(db: Db, mailboxAccountId: string): Promise<string> {
  const [row] = await db
    .insert(actionJobs)
    .values({
      mailboxAccountId,
      verb: 'unsubscribe',
      direction: 'forward',
      selector: {
        type: 'sender',
        senderId: '00000000-0000-4000-8000-000000000001',
        senderKey: SENDER_KEY,
      },
      resolvedMessageIds: [],
      requestedCount: 1,
      idempotencyKey: `unsubexec-test-${Math.random().toString(36).slice(2)}`,
      status: 'queued',
    })
    .returning({ id: actionJobs.id });
  return row!.id;
}

/**
 * Fake HTTP port — records calls, returns scripted statuses / throws.
 * `calls` keeps the legacy `{ url, timeoutMs }` shape; `pinCalls` records
 * the full opts (incl. the pinned address/family) so a test can prove the
 * pre-validated IP is what the port is told to dial.
 */
function fakeHttp(script: Array<number | Error>): UnsubHttpPort & {
  calls: Array<{ url: string; timeoutMs: number }>;
  pinCalls: Array<{ url: string; timeoutMs: number; pinnedAddress: string; family: 4 | 6 }>;
} {
  const calls: Array<{ url: string; timeoutMs: number }> = [];
  const pinCalls: Array<{
    url: string;
    timeoutMs: number;
    pinnedAddress: string;
    family: 4 | 6;
  }> = [];
  return {
    calls,
    pinCalls,
    async postOneClick(url, opts) {
      calls.push({ url, timeoutMs: opts.timeoutMs });
      pinCalls.push({
        url,
        timeoutMs: opts.timeoutMs,
        pinnedAddress: opts.pinnedAddress,
        family: opts.family,
      });
      const next = script.shift();
      if (next === undefined) throw new Error('fakeHttp script exhausted');
      if (next instanceof Error) throw next;
      return { status: next };
    },
  };
}

/** Public resolver fake — every hostname resolves to a public IP. */
const PUBLIC_RESOLVE = async (): Promise<string[]> => ['93.184.216.34'];

function ctx(attempt: number): WorkerContext {
  return {
    jobId: 'test-job',
    workerName: 'UnsubExecutionWorker',
    attempt,
    maxAttempts: UNSUB_MAX_ATTEMPTS,
    startedAt: new Date(),
    policy: 'perMailboxPolicy',
  };
}

describe('UnsubExecutionWorker', () => {
  let db: Db;
  let mailboxId: string;
  const envBefore = { ...process.env };

  beforeAll(async () => {
    db = await migratedDb();
  });

  beforeEach(async () => {
    await resetDb(db);
    mailboxId = await seedMailbox(db);
  });

  afterEach(() => {
    process.env.NODE_ENV = envBefore.NODE_ENV;
  });

  async function readState(actionId: string) {
    const [job] = await db.select().from(actionJobs).where(eq(actionJobs.id, actionId)).limit(1);
    const [policy] = await db
      .select()
      .from(senderPolicies)
      .where(eq(senderPolicies.senderKey, SENDER_KEY))
      .limit(1);
    const activities = await db
      .select()
      .from(activityLog)
      .where(eq(activityLog.senderKey, SENDER_KEY));
    const events = await db.select().from(outboxEvents);
    return { job: job!, policy: policy!, activities, events };
  }

  it('2xx → done: action row, policy status, 0-affected activity row with NO undo token (D58), outbox event', async () => {
    await seedSender(db, mailboxId);
    await seedPendingPolicy(db, mailboxId);
    const actionId = await seedExecutionJob(db, mailboxId);
    const http = fakeHttp([200]);
    const worker = new UnsubExecutionWorker({
      // PGlite drizzle vs PostgresJsDatabase nominal mismatch — same
      // `as never` convention as label-action.worker.test.ts:170.
      db: db as never,
      http,
      outbox: new OutboxPublisher(),
      resolveHost: PUBLIC_RESOLVE,
    });

    const result = await worker.processJob(
      { actionId, mailboxAccountId: mailboxId, idempotencyKey: 'k1' },
      ctx(1),
    );

    expect(result).toEqual({ outcome: 'done', httpStatus: 200, alreadyDone: false });
    // RFC 8058 request shape — the exact URL, once.
    expect(http.calls).toEqual([
      { url: 'https://unsub.shop.example/oneclick?u=42', timeoutMs: 10_000 },
    ]);

    const state = await readState(actionId);
    expect(state.job.status).toBe('done');
    expect(state.job.affectedCount).toBe(1); // the SENDER, not messages
    expect(state.job.errorCode).toBeNull();
    expect(state.job.undoToken).toBeNull(); // D58 — one-way
    expect(state.policy.unsubStatus).toBe('done');
    expect(state.activities).toHaveLength(1);
    expect(state.activities[0]!.action).toBe('unsubscribe');
    expect(state.activities[0]!.affectedCount).toBe(0); // no mail moved
    expect(state.activities[0]!.undoToken).toBeNull(); // D58
    expect(state.events).toHaveLength(1);
    expect(state.events[0]!.topic).toBe('actions.unsubscribe_executed');
    expect(state.events[0]!.payload).toMatchObject({ outcome: 'done', httpStatus: 200 });
  });

  it('4xx → failed terminally on the FIRST response (no retry — retrying spams the target)', async () => {
    await seedSender(db, mailboxId);
    await seedPendingPolicy(db, mailboxId);
    const actionId = await seedExecutionJob(db, mailboxId);
    const http = fakeHttp([404]);
    const worker = new UnsubExecutionWorker({
      // PGlite drizzle vs PostgresJsDatabase nominal mismatch — same
      // `as never` convention as label-action.worker.test.ts:170.
      db: db as never,
      http,
      outbox: new OutboxPublisher(),
      resolveHost: PUBLIC_RESOLVE,
    });

    const result = await worker.processJob(
      { actionId, mailboxAccountId: mailboxId, idempotencyKey: 'k1' },
      ctx(1),
    );

    expect(result.outcome).toBe('failed');
    expect(http.calls).toHaveLength(1);
    const state = await readState(actionId);
    expect(state.job.status).toBe('failed');
    expect(state.job.errorCode).toBe('UNSUB_TARGET_REJECTED');
    expect(state.job.affectedCount).toBe(0);
    expect(state.policy.unsubStatus).toBe('failed');
  });

  it('5xx → failed terminally on the FIRST response', async () => {
    await seedSender(db, mailboxId);
    await seedPendingPolicy(db, mailboxId);
    const actionId = await seedExecutionJob(db, mailboxId);
    const http = fakeHttp([503]);
    const worker = new UnsubExecutionWorker({
      // PGlite drizzle vs PostgresJsDatabase nominal mismatch — same
      // `as never` convention as label-action.worker.test.ts:170.
      db: db as never,
      http,
      outbox: new OutboxPublisher(),
      resolveHost: PUBLIC_RESOLVE,
    });

    const result = await worker.processJob(
      { actionId, mailboxAccountId: mailboxId, idempotencyKey: 'k1' },
      ctx(1),
    );

    expect(result.outcome).toBe('failed');
    expect(http.calls).toHaveLength(1);
    const state = await readState(actionId);
    expect(state.job.errorCode).toBe('UNSUB_TARGET_REJECTED');
    expect(state.policy.unsubStatus).toBe('failed');
  });

  it('3xx → ambiguous (redirects are never followed)', async () => {
    await seedSender(db, mailboxId);
    await seedPendingPolicy(db, mailboxId);
    const actionId = await seedExecutionJob(db, mailboxId);
    const http = fakeHttp([302]);
    const worker = new UnsubExecutionWorker({
      // PGlite drizzle vs PostgresJsDatabase nominal mismatch — same
      // `as never` convention as label-action.worker.test.ts:170.
      db: db as never,
      http,
      outbox: new OutboxPublisher(),
      resolveHost: PUBLIC_RESOLVE,
    });

    const result = await worker.processJob(
      { actionId, mailboxAccountId: mailboxId, idempotencyKey: 'k1' },
      ctx(1),
    );

    expect(result).toEqual({ outcome: 'ambiguous', httpStatus: 302, alreadyDone: false });
    const state = await readState(actionId);
    // Job is terminal-failed at the poll surface; the durable nuance is
    // the policy status + error code the FE reads.
    expect(state.job.status).toBe('failed');
    expect(state.job.errorCode).toBe('UNSUB_AMBIGUOUS_REDIRECT');
    expect(state.policy.unsubStatus).toBe('ambiguous');
    expect(state.events[0]!.payload).toMatchObject({ outcome: 'ambiguous', httpStatus: 302 });
  });

  it('network error on attempt 1 → rethrows TransientError (BullMQ retries); nothing recorded yet', async () => {
    await seedSender(db, mailboxId);
    await seedPendingPolicy(db, mailboxId);
    const actionId = await seedExecutionJob(db, mailboxId);
    const http = fakeHttp([new Error('connect ETIMEDOUT')]);
    const worker = new UnsubExecutionWorker({
      // PGlite drizzle vs PostgresJsDatabase nominal mismatch — same
      // `as never` convention as label-action.worker.test.ts:170.
      db: db as never,
      http,
      outbox: new OutboxPublisher(),
      resolveHost: PUBLIC_RESOLVE,
    });

    await expect(
      worker.processJob({ actionId, mailboxAccountId: mailboxId, idempotencyKey: 'k1' }, ctx(1)),
    ).rejects.toBeInstanceOf(TransientError);

    const state = await readState(actionId);
    expect(state.job.status).toBe('executing'); // mid-flight, retry pending
    expect(state.policy.unsubStatus).toBe('pending');
    expect(state.activities).toHaveLength(0);
  });

  it('network error on the LAST attempt → failed recorded honestly (exactly one retry total)', async () => {
    await seedSender(db, mailboxId);
    await seedPendingPolicy(db, mailboxId);
    const actionId = await seedExecutionJob(db, mailboxId);
    const http = fakeHttp([new Error('connect ECONNREFUSED')]);
    const worker = new UnsubExecutionWorker({
      // PGlite drizzle vs PostgresJsDatabase nominal mismatch — same
      // `as never` convention as label-action.worker.test.ts:170.
      db: db as never,
      http,
      outbox: new OutboxPublisher(),
      resolveHost: PUBLIC_RESOLVE,
    });

    const result = await worker.processJob(
      { actionId, mailboxAccountId: mailboxId, idempotencyKey: 'k1' },
      ctx(UNSUB_MAX_ATTEMPTS),
    );

    expect(result.outcome).toBe('failed');
    expect(result.httpStatus).toBeNull();
    const state = await readState(actionId);
    expect(state.job.errorCode).toBe('UNSUB_NETWORK_ERROR');
    expect(state.policy.unsubStatus).toBe('failed');
  });

  it('idempotent replay — a retried job after the terminal tx never re-POSTs', async () => {
    await seedSender(db, mailboxId);
    await seedPendingPolicy(db, mailboxId);
    const actionId = await seedExecutionJob(db, mailboxId);
    const http = fakeHttp([200]);
    const worker = new UnsubExecutionWorker({
      // PGlite drizzle vs PostgresJsDatabase nominal mismatch — same
      // `as never` convention as label-action.worker.test.ts:170.
      db: db as never,
      http,
      outbox: new OutboxPublisher(),
      resolveHost: PUBLIC_RESOLVE,
    });

    const first = await worker.processJob(
      { actionId, mailboxAccountId: mailboxId, idempotencyKey: 'k1' },
      ctx(1),
    );
    expect(first.alreadyDone).toBe(false);

    const replay = await worker.processJob(
      { actionId, mailboxAccountId: mailboxId, idempotencyKey: 'k1' },
      ctx(2),
    );
    expect(replay.alreadyDone).toBe(true);
    expect(replay.outcome).toBe('done');
    expect(http.calls).toHaveLength(1); // the wire saw exactly one POST

    const state = await readState(actionId);
    expect(state.activities).toHaveLength(1); // no duplicate audit row
  });

  it('method ≠ one_click at execution time → failed UNSUB_NOT_ONE_CLICK, no POST (ADR-0006 invariant)', async () => {
    await seedSender(db, mailboxId, { method: 'mailto', url: 'mailto:opt-out@shop.example' });
    await seedPendingPolicy(db, mailboxId);
    const actionId = await seedExecutionJob(db, mailboxId);
    const http = fakeHttp([]);
    const worker = new UnsubExecutionWorker({
      // PGlite drizzle vs PostgresJsDatabase nominal mismatch — same
      // `as never` convention as label-action.worker.test.ts:170.
      db: db as never,
      http,
      outbox: new OutboxPublisher(),
      resolveHost: PUBLIC_RESOLVE,
    });

    const result = await worker.processJob(
      { actionId, mailboxAccountId: mailboxId, idempotencyKey: 'k1' },
      ctx(1),
    );

    expect(result.outcome).toBe('failed');
    expect(http.calls).toHaveLength(0);
    const state = await readState(actionId);
    expect(state.job.errorCode).toBe('UNSUB_NOT_ONE_CLICK');
  });

  describe('SSRF hardening', () => {
    async function runAgainst(
      url: string,
      opts: { allowInsecure?: boolean; resolveHost?: (h: string) => Promise<string[]> } = {},
    ) {
      await seedSender(db, mailboxId, { url });
      await seedPendingPolicy(db, mailboxId);
      const actionId = await seedExecutionJob(db, mailboxId);
      const http = fakeHttp([200]);
      const worker = new UnsubExecutionWorker({
        db: db as never,
        http,
        outbox: new OutboxPublisher(),
        resolveHost: opts.resolveHost ?? PUBLIC_RESOLVE,
        ...(opts.allowInsecure !== undefined ? { allowInsecureTargets: opts.allowInsecure } : {}),
      });
      const result = await worker.processJob(
        { actionId, mailboxAccountId: mailboxId, idempotencyKey: 'k1' },
        ctx(1),
      );
      const state = await readState(actionId);
      return { result, http, state };
    }

    it('rejects plain http without the flag', async () => {
      const { result, http, state } = await runAgainst('http://unsub.shop.example/x');
      expect(result.outcome).toBe('failed');
      expect(http.calls).toHaveLength(0);
      expect(state.job.errorCode).toBe('UNSUB_INSECURE_SCHEME');
      expect(state.policy.unsubStatus).toBe('failed');
    });

    it('rejects a hostname resolving to a private IP (RFC 1918)', async () => {
      const { result, http, state } = await runAgainst('https://internal.shop.example/x', {
        resolveHost: async () => ['10.1.2.3'],
      });
      expect(result.outcome).toBe('failed');
      expect(http.calls).toHaveLength(0);
      expect(state.job.errorCode).toBe('UNSUB_PRIVATE_TARGET');
    });

    it('rejects a hostname where ANY resolved address is private (multi-A defense)', async () => {
      const { result, http } = await runAgainst('https://rebind.shop.example/x', {
        resolveHost: async () => ['93.184.216.34', '169.254.169.254'],
      });
      expect(result.outcome).toBe('failed');
      expect(http.calls).toHaveLength(0);
    });

    it('rejects literal loopback / link-local / v6 ULA targets', async () => {
      for (const url of [
        'https://127.0.0.1/x',
        'https://169.254.169.254/x', // GCP metadata
        'https://[::1]/x',
        'https://[fd00::1]/x',
        'https://192.168.1.10/x',
      ]) {
        const { result, http } = await runAgainst(url);
        expect(result.outcome).toBe('failed');
        expect(http.calls).toHaveLength(0);
        // Wipe + re-seed between URLs — sharing the migrated db is safe
        // (the SSRF check short-circuits before any HTTP call), and a
        // per-iteration migration replay blows the 30s test budget.
        await resetDb(db);
        mailboxId = await seedMailbox(db);
      }
    });

    it('UNSUB_ALLOW_INSECURE_TARGETS permits http + loopback (local smoke fake)', async () => {
      process.env.NODE_ENV = 'test';
      const { result, http } = await runAgainst('http://127.0.0.1:4999/unsub', {
        allowInsecure: true,
      });
      expect(result.outcome).toBe('done');
      expect(http.calls).toEqual([{ url: 'http://127.0.0.1:4999/unsub', timeoutMs: 10_000 }]);
    });

    it('the flag does NOT unlock non-loopback private ranges', async () => {
      process.env.NODE_ENV = 'test';
      const { result, http } = await runAgainst('http://10.0.0.5/unsub', {
        allowInsecure: true,
      });
      expect(result.outcome).toBe('failed');
      expect(http.calls).toHaveLength(0);
    });

    it('the flag is dead in production (NODE_ENV hard-refusal, defense in depth)', async () => {
      process.env.NODE_ENV = 'production';
      const { result, http, state } = await runAgainst('http://127.0.0.1:4999/unsub', {
        allowInsecure: true,
      });
      expect(result.outcome).toBe('failed');
      expect(http.calls).toHaveLength(0);
      expect(state.job.errorCode).toBe('UNSUB_INSECURE_SCHEME');
    });

    it('rejects an unparseable URL', async () => {
      const { result, http, state } = await runAgainst('not a url');
      expect(result.outcome).toBe('failed');
      expect(http.calls).toHaveLength(0);
      expect(state.job.errorCode).toBe('UNSUB_INVALID_URL');
    });

    it('rejects when DNS resolution fails', async () => {
      const { result, http, state } = await runAgainst('https://gone.shop.example/x', {
        resolveHost: async () => {
          throw new Error('ENOTFOUND');
        },
      });
      expect(result.outcome).toBe('failed');
      expect(http.calls).toHaveLength(0);
      expect(state.job.errorCode).toBe('UNSUB_DNS_FAILURE');
    });

    it('pins the port to the pre-flight-validated address (DNS-rebinding TOCTOU closed)', async () => {
      // The pre-flight resolver returns ONE public IP. The port must be
      // told to dial exactly that address — so even if a hostile
      // authoritative server returned a different (private/metadata) IP on
      // a second resolution, the socket can only reach the validated one.
      const { result, http } = await runAgainst('https://unsub.shop.example/oneclick?u=42', {
        resolveHost: async () => ['93.184.216.34'],
      });
      expect(result.outcome).toBe('done');
      expect(http.pinCalls).toEqual([
        {
          url: 'https://unsub.shop.example/oneclick?u=42',
          timeoutMs: 10_000,
          pinnedAddress: '93.184.216.34',
          family: 4,
        },
      ]);
    });

    it('pins the FIRST validated address when DNS returns multiple A records', async () => {
      // All resolved addresses pass classifyAddress; the port is pinned to
      // the first so the dialed IP is deterministic and pre-validated.
      const { result, http } = await runAgainst('https://multi.shop.example/x', {
        resolveHost: async () => ['203.0.113.7', '198.51.100.9'],
      });
      expect(result.outcome).toBe('done');
      expect(http.pinCalls[0]!.pinnedAddress).toBe('203.0.113.7');
      expect(http.pinCalls[0]!.family).toBe(4);
    });

    it('pins an IPv6 literal host with family 6', async () => {
      const { result, http } = await runAgainst('https://[2606:4700::6810:84e5]/x');
      expect(result.outcome).toBe('done');
      expect(http.pinCalls[0]!.pinnedAddress).toBe('2606:4700::6810:84e5');
      expect(http.pinCalls[0]!.family).toBe(6);
    });
  });
});

describe('buildPinnedLookup', () => {
  it('always yields the pinned address + family, ignoring the requested hostname', () => {
    const lookup = buildPinnedLookup('93.184.216.34', 4);
    const seen: Array<{ err: unknown; address: unknown; family: unknown }> = [];
    lookup('attacker-controlled.example', {}, (err, address, family) => {
      seen.push({ err, address, family });
    });
    expect(seen).toEqual([{ err: null, address: '93.184.216.34', family: 4 }]);
  });

  it('honors the undici-style `all` option (array form) when asked', () => {
    const lookup = buildPinnedLookup('2606:4700::1', 6);
    const seen: Array<{ err: unknown; result: unknown }> = [];
    lookup('attacker-controlled.example', { all: true }, (err, result) => {
      seen.push({ err, result });
    });
    expect(seen).toEqual([{ err: null, result: [{ address: '2606:4700::1', family: 6 }] }]);
  });

  it('accepts the (hostname, callback) two-arg form', () => {
    const lookup = buildPinnedLookup('10.0.0.0', 4); // value is opaque here — pinning is verbatim
    const seen: Array<{ err: unknown; address: unknown; family: unknown }> = [];
    (lookup as (h: string, cb: (e: unknown, a: string, f: number) => void) => void)(
      'attacker-controlled.example',
      (err, address, family) => {
        seen.push({ err, address, family });
      },
    );
    expect(seen).toEqual([{ err: null, address: '10.0.0.0', family: 4 }]);
  });
});

describe('unsubExecutionJobOptions', () => {
  it('caps BullMQ attempts at the unsub budget (first try + ONE retry)', () => {
    const opts = unsubExecutionJobOptions('unsubexec-abc');
    expect(opts.jobId).toBe('unsubexec-abc');
    expect(opts.attempts).toBe(2);
    expect(opts.removeOnFail).toBe(false);
  });
});

describe('classifyAddress', () => {
  it.each([
    ['93.184.216.34', 'public'],
    ['8.8.8.8', 'public'],
    ['127.0.0.1', 'loopback'],
    ['127.255.255.255', 'loopback'],
    ['10.0.0.1', 'private'],
    ['172.16.0.1', 'private'],
    ['172.31.255.255', 'private'],
    ['172.32.0.1', 'public'],
    ['192.168.0.1', 'private'],
    ['169.254.169.254', 'private'],
    ['100.64.0.1', 'private'],
    ['0.0.0.0', 'private'],
    ['::1', 'loopback'],
    ['::', 'private'],
    ['fd12:3456::1', 'private'],
    ['fc00::1', 'private'],
    ['fe80::1', 'private'],
    ['2606:4700::6810:84e5', 'public'],
    ['::ffff:10.0.0.1', 'private'],
    ['::ffff:127.0.0.1', 'loopback'],
  ] as const)('%s → %s', (address, expected) => {
    expect(classifyAddress(address)).toBe(expected);
  });
});
