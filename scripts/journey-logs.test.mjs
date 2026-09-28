import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { deriveMailboxRef, normalize, readQuota, summarize } from './journey-logs.mjs';

const MAILBOX = '00000000-0000-4000-8000-000000000001';
const REF = 'ref_aaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER = 'ref_bbbbbbbbbbbbbbbbbbbbbbbb';

const row = (ts, p) => ({ timestamp: ts, jsonPayload: p });
const scanBegin = (ts) =>
  row(ts, {
    kind: 'initial_sync.stage_begin',
    stage: 'fetching_metadata',
    mailboxAccountId: MAILBOX,
  });
const scanDone = (ts, messagesSynced) =>
  row(ts, {
    kind: 'initial_sync.fetchAndStoreMetadata_done',
    mailboxAccountId: MAILBOX,
    messagesSynced,
  });
const started = (ts, ref, worker = 'InitialSyncWorker', extra = {}) =>
  row(ts, { kind: 'worker.started', worker, mailboxRef: ref, attempt: 1, ...extra });
const succeeded = (ts, ref, worker, result = {}, extra = {}) =>
  row(ts, { kind: 'worker.succeeded', worker, mailboxRef: ref, attempt: 1, result, ...extra });

test('derives the ref from the InitialSyncWorker start beside the scan, confirmed by messagesSynced', () => {
  const mailboxRows = normalize([
    scanBegin('2026-01-01T00:00:05.500Z'),
    scanDone('2026-01-01T01:00:00Z', 40),
  ]);
  const workerRows = normalize([
    started('2026-01-01T00:00:05.400Z', REF),
    succeeded('2026-01-01T01:00:10Z', REF, 'InitialSyncWorker', { messagesSynced: 40 }),
  ]);
  assert.equal(deriveMailboxRef(mailboxRows, workerRows).ref, REF);
});

test('two scans starting in the same instant: picks only the one whose result matches', () => {
  const mailboxRows = normalize([
    scanBegin('2026-01-01T00:00:05.500Z'),
    scanDone('2026-01-01T01:00:00Z', 40),
  ]);
  const workerRows = normalize([
    started('2026-01-01T00:00:05.300Z', OTHER),
    started('2026-01-01T00:00:05.400Z', REF),
    succeeded('2026-01-01T00:30:00Z', OTHER, 'InitialSyncWorker', { messagesSynced: 7 }),
    succeeded('2026-01-01T01:00:10Z', REF, 'InitialSyncWorker', { messagesSynced: 40 }),
  ]);
  assert.equal(deriveMailboxRef(mailboxRows, workerRows).ref, REF);
});

test('two scans nothing tells apart: refuses rather than guessing', () => {
  const mailboxRows = normalize([scanBegin('2026-01-01T00:00:05.500Z')]);
  const workerRows = normalize([
    started('2026-01-01T00:00:05.300Z', OTHER),
    started('2026-01-01T00:00:05.400Z', REF),
  ]);
  const { ref, reason } = deriveMailboxRef(mailboxRows, workerRows);
  assert.equal(ref, null);
  assert.match(reason, /ambiguous/);
});

test('no scan in the window: no ref', () => {
  assert.equal(deriveMailboxRef([], normalize([started('2026-01-01T00:00:05Z', REF)])).ref, null);
});

test('no log lines at all is UNVERIFIED, never a clean result', () => {
  const summary = summarize({ mailboxRows: [], workerRows: [], quota: null, ref: null });
  assert.equal(summary.status, 'UNVERIFIED');
});

test('lock timeouts, retried actions and dead letters are all flagged; unrecovered sync is user-visible', () => {
  const mailboxRows = normalize([
    row('2026-01-01T02:00:00Z', { kind: 'mailbox_lock.acquire_failed', mailboxAccountId: MAILBOX }),
    row('2026-01-01T02:05:00Z', {
      kind: 'worker.incremental.terminal_failed',
      mailboxAccountId: MAILBOX,
    }),
  ]);
  const workerRows = normalize([
    started('2026-01-01T01:59:00Z', REF, 'LabelActionWorker', { jobRef: 'ref_job1' }),
    row('2026-01-01T02:00:00Z', {
      kind: 'worker.retried',
      worker: 'LabelActionWorker',
      mailboxRef: REF,
      jobRef: 'ref_job1',
      attempt: 1,
    }),
    succeeded(
      '2026-01-01T02:00:30Z',
      REF,
      'LabelActionWorker',
      { affectedCount: 12 },
      { jobRef: 'ref_job1', attempt: 2 },
    ),
    row('2026-01-01T02:05:00Z', {
      kind: 'worker.dead_lettered',
      worker: 'IncrementalSyncWorker',
      mailboxRef: REF,
      attempt: 5,
    }),
  ]);
  const codes = summarize({ mailboxRows, workerRows, quota: null, ref: REF }).flags.map(
    (f) => `${f.severity}:${f.code}`,
  );
  assert.ok(codes.includes('user:LOCK_TIMEOUTS'));
  assert.ok(codes.includes('user:ACTION_RETRIED'));
  assert.ok(codes.includes('ops:DEAD_LETTERED'));
  assert.ok(codes.includes('user:INCREMENTAL_FAILING'));
});

test('a sync that succeeds after the failures downgrades them to recovered', () => {
  const mailboxRows = normalize([
    row('2026-01-01T02:05:00Z', {
      kind: 'worker.incremental.terminal_failed',
      mailboxAccountId: MAILBOX,
    }),
  ]);
  const workerRows = normalize([
    succeeded('2026-01-01T02:09:00Z', REF, 'IncrementalSyncWorker', { labelChanges: 9 }),
  ]);
  const codes = summarize({ mailboxRows, workerRows, quota: null, ref: REF }).flags.map(
    (f) => f.code,
  );
  assert.ok(codes.includes('INCREMENTAL_FAILED_RECOVERED'));
  assert.ok(!codes.includes('INCREMENTAL_FAILING'));
});

test('a finished scan with no ready email is flagged; one sent after ready is not', () => {
  const mailboxRows = normalize([scanBegin('2026-01-01T00:00:05Z')]);
  const ready = succeeded('2026-01-01T00:10:00Z', REF, 'InitialSyncWorker', { messagesSynced: 5 });
  const email = succeeded('2026-01-01T00:10:01Z', REF, 'EmailSendWorker', {
    kind: 'sync-complete',
    outcome: 'sent',
  });
  const flagged = (rows) =>
    summarize({ mailboxRows, workerRows: normalize(rows), quota: null, ref: REF }).flags.map(
      (f) => f.code,
    );
  assert.ok(flagged([ready]).includes('READY_EMAIL_MISSING'));
  assert.ok(!flagged([ready, email]).includes('READY_EMAIL_MISSING'));
});

test('a scan reading below 80% of quota pace is flagged, and only when the pace is known', () => {
  const mailboxRows = normalize([
    scanBegin('2026-01-01T00:00:00Z'),
    row('2026-01-01T00:00:10Z', {
      kind: 'initial_sync.fetch_loop_begin',
      mailboxAccountId: MAILBOX,
      toFetch: 600,
    }),
    row('2026-01-01T00:02:10Z', {
      kind: 'initial_sync.fetch_loop_done',
      mailboxAccountId: MAILBOX,
      unreadable: 0,
    }),
  ]);
  // 600/min; this scan read 300/min.
  const quota = { unitsPerMin: 12_000, messagesGetCost: 20, since: '2025-12-01T00:00:00Z' };
  const codes = (q) =>
    summarize({ mailboxRows, workerRows: [], quota: q, ref: null }).flags.map((f) => f.code);
  assert.ok(codes(quota).includes('SCAN_SLOWER_THAN_QUOTA'));
  assert.ok(!codes(null).includes('SCAN_SLOWER_THAN_QUOTA'));
  // A scan that ran before today's quota settings landed is not judged by them.
  assert.ok(!codes({ ...quota, since: '2026-02-01T00:00:00Z' }).includes('SCAN_SLOWER_THAN_QUOTA'));
  assert.ok(!codes({ ...quota, since: null }).includes('SCAN_SLOWER_THAN_QUOTA'));
});

test('retries of one scan are one scan; a later scan does not inherit its failures', () => {
  const mailboxRows = normalize([
    scanBegin('2026-01-01T00:00:00Z'),
    scanBegin('2026-01-01T00:00:10Z'),
    scanBegin('2026-01-01T00:00:30Z'),
    scanBegin('2026-01-02T00:00:00Z'),
    scanBegin('2026-01-02T00:10:00Z'),
  ]);
  const failed = (ts, attempt) =>
    row(ts, { kind: 'worker.failed', worker: 'InitialSyncWorker', mailboxRef: REF, attempt });
  const workerRows = normalize([
    failed('2026-01-01T00:00:05Z', 1),
    failed('2026-01-01T00:00:15Z', 2),
    failed('2026-01-01T00:00:35Z', 3),
    row('2026-01-01T00:00:35.1Z', {
      kind: 'worker.dead_lettered',
      worker: 'InitialSyncWorker',
      mailboxRef: REF,
      attempt: 3,
    }),
    failed('2026-01-02T00:05:00Z', 1),
    succeeded('2026-01-02T01:00:00Z', REF, 'InitialSyncWorker', { messagesSynced: 9 }),
  ]);
  const { scans } = summarize({ mailboxRows, workerRows, quota: null, ref: REF });
  assert.equal(scans.length, 2);
  assert.deepEqual(
    scans.map((s) => [s.attempts, s.failures, Boolean(s.gaveUpAt), Boolean(s.readyAt)]),
    [
      [3, 3, true, false],
      [2, 1, false, true],
    ],
  );
});

test('a scan with no outcome and no progress for 15 minutes is stalled, not slow', () => {
  const mailboxRows = normalize([
    scanBegin('2026-01-01T00:00:00Z'),
    row('2026-01-01T00:05:00Z', {
      kind: 'initial_sync.fetch_flush',
      mailboxAccountId: MAILBOX,
      processed: 500,
      total: 9000,
    }),
  ]);
  const codes = (now) =>
    summarize({
      mailboxRows,
      workerRows: [],
      quota: null,
      ref: null,
      now: Date.parse(now),
    }).flags.map((f) => f.code);
  assert.ok(!codes('2026-01-01T00:10:00Z').includes('SCAN_STALLED'));
  assert.ok(codes('2026-01-01T00:30:00Z').includes('SCAN_STALLED'));
});

test('quota pace is read from the files that set it (fails loudly if either moves)', () => {
  const quota = readQuota();
  assert.ok(
    quota,
    'readQuota() returned null — deploy-cloud-run.yml or gmail-client.service.ts changed shape',
  );
  assert.ok(quota.unitsPerMin > 0 && quota.messagesGetCost > 0);
});

test('a read is priced on the metric the deploy actually sets', () => {
  const root = mkdtempSync(join(tmpdir(), 'journey-quota-'));
  mkdirSync(join(root, '.github/workflows'), { recursive: true });
  mkdirSync(join(root, 'apps/api/src/gmail'), { recursive: true });
  writeFileSync(
    join(root, 'apps/api/src/gmail/gmail-client.service.ts'),
    "    messagesGet: metric === 'gmail.googleapis.com/default' ? 5 : 20,\n",
  );
  const deploy = (metric) =>
    writeFileSync(
      join(root, '.github/workflows/deploy-cloud-run.yml'),
      `--set-env-vars="^|^GMAIL_QUOTA_UNITS_PER_MIN=12000|GMAIL_QUOTA_METRIC=${metric}|X=1"\n`,
    );
  deploy('gmail.googleapis.com/default');
  assert.equal(readQuota(root).messagesGetCost, 5);
  deploy('gmail.googleapis.com/total_query_cost');
  assert.equal(readQuota(root).messagesGetCost, 20);
});

test('a scoring run with no LLM explanations is flagged; one with some is not', () => {
  const mailboxRows = normalize([scanBegin('2026-01-01T00:00:00Z')]);
  const ready = succeeded('2026-01-01T01:00:00Z', REF, 'InitialSyncWorker', { messagesSynced: 5 });
  const scored = (llm) =>
    succeeded('2026-01-01T01:00:30Z', REF, 'ScoreWorker', {
      decisionsWritten: 100,
      llmExplanations: llm,
      templateExplanations: 100 - llm,
    });
  const codes = (llm) =>
    summarize({
      mailboxRows,
      workerRows: normalize([ready, scored(llm)]),
      quota: null,
      ref: REF,
    }).flags.map((f) => f.code);
  assert.ok(codes(0).includes('LLM_OFF'));
  assert.ok(!codes(40).includes('LLM_OFF'));
});

test('a run the provider refused is flagged by its skipped calls, even beside reused prose', () => {
  // Since the breaker, a refused account logs `llm.provider_rejected` once
  // and the run counts the skipped calls as `llmBlocked`. Reused prose
  // keeps `llmExplanations` above 0, so "0 from the LLM" alone misses it.
  const mailboxRows = normalize([scanBegin('2026-01-01T00:00:00Z')]);
  const ready = succeeded('2026-01-01T01:00:00Z', REF, 'InitialSyncWorker', { messagesSynced: 5 });
  const flags = (result) =>
    summarize({
      mailboxRows,
      workerRows: normalize([
        ready,
        succeeded('2026-01-01T01:00:30Z', REF, 'ScoreWorker', { decisionsWritten: 100, ...result }),
      ]),
      quota: null,
      ref: REF,
    }).flags;
  const refused = flags({
    llmExplanations: 40,
    llmReused: 40,
    templateExplanations: 60,
    llmCalls: 1,
    llmBlocked: 59,
  });
  const flag = refused.find((f) => f.code === 'LLM_REFUSED');
  assert.ok(flag, JSON.stringify(refused));
  assert.match(flag.detail, /llm\.provider_rejected/);
  assert.match(flag.detail, /59/);
  const off = flags({
    llmExplanations: 0,
    templateExplanations: 100,
    llmCalls: 100,
    llmBlocked: 0,
  });
  assert.ok(!off.some((f) => f.code === 'LLM_REFUSED'));
  assert.match(off.find((f) => f.code === 'LLM_OFF').detail, /reasoning\.adapter_error/);
});

test('recommendations landing minutes after "ready" are flagged', () => {
  const mailboxRows = normalize([scanBegin('2026-01-01T00:00:00Z')]);
  const ready = succeeded('2026-01-01T01:00:00Z', REF, 'InitialSyncWorker', { messagesSynced: 5 });
  const scoredAt = (ts) =>
    succeeded(ts, REF, 'ScoreWorker', {
      decisionsWritten: 50,
      llmExplanations: 50,
      templateExplanations: 0,
    });
  const codes = (ts) =>
    summarize({
      mailboxRows,
      workerRows: normalize([ready, scoredAt(ts)]),
      quota: null,
      ref: REF,
    }).flags.map((f) => f.code);
  assert.ok(!codes('2026-01-01T01:00:40Z').includes('RECS_LATE'));
  assert.ok(codes('2026-01-01T01:07:00Z').includes('RECS_LATE'));
});

test("lock timeouts are a user problem only when the user's own action retried", () => {
  const mailboxRows = normalize([
    row('2026-01-01T02:00:00Z', { kind: 'mailbox_lock.acquire_failed', mailboxAccountId: MAILBOX }),
  ]);
  const severity = summarize({ mailboxRows, workerRows: [], quota: null, ref: REF }).flags.find(
    (f) => f.code === 'LOCK_TIMEOUTS',
  ).severity;
  assert.equal(severity, 'ops');
});

test('other lines naming the mailbox are counted, and failure kinds are flagged', () => {
  const mailboxRows = normalize([
    scanBegin('2026-01-01T00:00:00Z'),
    row('2026-01-01T00:05:00Z', {
      kind: 'snooze.mapping_refresh_failed',
      mailboxAccountId: MAILBOX,
    }),
    row('2026-01-01T00:06:00Z', {
      kind: 'snooze.mapping_refresh_failed',
      mailboxAccountId: MAILBOX,
    }),
    row('2026-01-01T00:07:00Z', { kind: 'mailbox_lock.pool_wait', mailboxAccountId: MAILBOX }),
  ]);
  const summary = summarize({ mailboxRows, workerRows: [], quota: null, ref: null });
  assert.equal(summary.otherKinds.get('snooze.mapping_refresh_failed').count, 2);
  assert.ok(!summary.otherKinds.has('mailbox_lock.pool_wait'));
  assert.ok(summary.flags.some((f) => f.code === 'OTHER_FAILURES'));
});

test('a failed scan whose first Gmail call never succeeded says to suspect access', () => {
  const detail = (rows) =>
    summarize({
      mailboxRows: normalize(rows),
      workerRows: normalize([
        row('2026-01-01T00:01:00Z', {
          kind: 'worker.dead_lettered',
          worker: 'InitialSyncWorker',
          mailboxRef: REF,
          attempt: 5,
        }),
      ]),
      quota: null,
      ref: REF,
    }).flags.find((f) => f.code === 'SCAN_FAILED').detail;
  assert.match(detail([scanBegin('2026-01-01T00:00:00Z')]), /suspect access/);
  const reachedGmail = row('2026-01-01T00:00:01Z', {
    kind: 'initial_sync.getProfile_done',
    mailboxAccountId: MAILBOX,
  });
  assert.doesNotMatch(detail([scanBegin('2026-01-01T00:00:00Z'), reachedGmail]), /suspect access/);
});
