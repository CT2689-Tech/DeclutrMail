#!/usr/bin/env node
/**
 * scripts/journey-logs.mjs
 *
 * The Cloud Run log half of `/ct-journey`: one mailbox's scans, the jobs its
 * user's actions ran, and the background work around them.
 *
 *   node scripts/journey-logs.mjs <mailboxAccountId> [--since=ISO] [--until=ISO]
 *                                 [--ref=ref_…] [--project=declutrmail-ai-prod]
 *
 * WHY A SCRIPT. The mailbox id appears raw only on `initial_sync.*`,
 * `mailbox_lock.*`, `sync.mailbox_labels`, `mailbox.stuck_unnoticed` and
 * `worker.incremental.terminal_failed`. Every `worker.*` line carries
 * `mailboxRef` instead: a keyed HMAC (`telemetryReference` in
 * packages/workers/src/base-declutr-worker.ts) that cannot be recomputed
 * off-box. `http.request` lines carry no identity at all. So the ref is
 * recovered from the one instant both forms are logged together: the
 * `InitialSyncWorker` `worker.started` line and the mailbox's own
 * `initial_sync.stage_begin`, confirmed by a matching `messagesSynced`.
 * Two candidates that nothing tells apart → no ref. Never a guess: a wrong
 * ref reports someone else's jobs as this user's.
 *
 * NOTHING SEEN IS NOT HEALTHY. Cloud Logging keeps ~30 days. No lines →
 * UNVERIFIED and exit 3, never an all-clear.
 *
 * Exit: 0 no flags · 1 flags · 2 logs unreadable · 3 no data (UNVERIFIED).
 *
 * Privacy (D7): these log lines carry ids, counts, timings and error class
 * names only. Nothing message-derived is read or printed.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const QUERY_LIMIT = 5000;
/** Jobs a person's click (or their Autopilot rule) caused — not sync or cron plumbing. */
const ACTION_WORKERS = new Set([
  'LabelActionWorker',
  'UnsubExecutionWorker',
  'AutopilotActionWorker',
  'ActionRecoveryWorker',
]);
/** Worth a look past this: a job holding the mailbox lock this long starves every other job for that mailbox. */
const LONG_JOB_MS = 120_000;
/** Action-job bursts split on a gap longer than this. */
const BURST_GAP_MS = 120_000;
/** A scan with no terminal outcome and no progress line for this long is stuck, not slow. */
const STALLED_MS = 15 * 60_000;
/** InitialSyncWorker logs `worker.started` just before its first `stage_begin`. */
const REF_MATCH_BEFORE_MS = 5_000;
const REF_MATCH_AFTER_MS = 1_000;
const TERMINAL = new Set(['worker.succeeded', 'worker.dead_lettered']);
/** Mailbox-id lines this report already reads; anything else is listed under OTHER. */
const SUMMARIZED_KIND =
  /^(initial_sync\.|mailbox_lock\.|gmail\.getClient|worker\.incremental\.terminal_failed$|mailbox\.stuck_unnoticed$|sync\.mailbox_labels$)/;
/** The stuck watchdog logs every 15 min forever; read it apart so it cannot crowd out the signup era. */
const WATCHDOG_LIMIT = 500;

const t = (row) => Date.parse(row.ts);
/** `09-25 04:41:53` — a window can span days, so times carry the date. */
const stamp = (iso) => (iso ? `${iso.slice(5, 10)} ${iso.slice(11, 19)}` : '—');

const QUOTA_SOURCES = {
  units: {
    file: '.github/workflows/deploy-cloud-run.yml',
    pattern: /GMAIL_QUOTA_UNITS_PER_MIN=(\d+)/,
  },
  metric: {
    file: '.github/workflows/deploy-cloud-run.yml',
    pattern: /GMAIL_QUOTA_METRIC=([\w./-]+)/,
  },
  // `messagesGet: metric === '<metric>' ? <units on it> : <units otherwise>,`
  cost: {
    file: 'apps/api/src/gmail/gmail-client.service.ts',
    pattern: /^\s+messagesGet:\s*metric === '([\w./-]+)' \? (\d+) : (\d+),/m,
  },
};

/**
 * OUR configured Gmail pace (limiter budget ÷ what we charge per
 * `messages.get` on the deployed quota metric), read from the files that
 * set it rather than hardcoded here: a copied constant is exactly the
 * literal that goes stale.
 * It is not Gmail's ceiling. On 2026-09-25 the enforced per-user limit was
 * `defaultPerMinutePerUser` = 15,000 at 5 units per read, while the 20-unit
 * `totalQueryCost` meter was unlimited — Cloud Monitoring
 * `serviceruntime.googleapis.com/quota/*` is the source for the real one.
 * `since` is when these exact values landed (git pickaxe): a scan that ran
 * before then ran under other settings and must not be judged against them. Unreadable → null; undatable → `since: null`.
 * Either way the report says "unknown" instead of comparing.
 */
export function readQuota(root = REPO_ROOT) {
  const found = {};
  for (const [key, { file, pattern }] of Object.entries(QUOTA_SOURCES)) {
    let text;
    try {
      text = readFileSync(`${root}/${file}`, 'utf8');
    } catch {
      return null; // file moved — reported as "quota pace unknown"
    }
    const match = text.match(pattern);
    if (!match) return null;
    found[key] = { file, line: match[0].trim(), groups: match.slice(1) };
  }
  const [costMetric, onMetric, otherwise] = found.cost.groups;
  const messagesGetCost = Number(found.metric.groups[0] === costMetric ? onMetric : otherwise);
  let since = null;
  try {
    const dates = Object.values(found).map(({ file, line }) =>
      execFileSync('git', ['-C', root, 'log', '-1', '--format=%cI', '-S', line, '--', file], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim(),
    );
    if (dates.every(Boolean)) since = new Date(Math.max(...dates.map(Date.parse))).toISOString();
  } catch {
    since = null; // no git history — reported as "quota config date unknown"
  }
  return { unitsPerMin: Number(found.units.groups[0]), messagesGetCost, since };
}

/** Cloud Logging entries → `{ ts, p }` rows in time order. */
export function normalize(entries) {
  return entries
    .map((entry) => ({ ts: entry.timestamp, p: entry.jsonPayload ?? {} }))
    .filter((row) => typeof row.ts === 'string' && typeof row.p.kind === 'string')
    .sort((a, b) => t(a) - t(b));
}

/**
 * Recover this mailbox's `mailboxRef` from its initial sync. Returns
 * `{ ref: null, reason }` rather than choosing between candidates.
 */
export function deriveMailboxRef(mailboxRows, initialWorkerRows) {
  const begins = mailboxRows.filter(
    (r) => r.p.kind === 'initial_sync.stage_begin' && r.p.stage === 'fetching_metadata',
  );
  if (begins.length === 0) {
    return { ref: null, reason: 'no initial_sync.stage_begin in the window' };
  }
  const candidates = new Set();
  for (const begin of begins) {
    for (const row of initialWorkerRows) {
      const delta = t(row) - t(begin);
      if (
        row.p.kind === 'worker.started' &&
        typeof row.p.mailboxRef === 'string' &&
        delta >= -REF_MATCH_BEFORE_MS &&
        delta <= REF_MATCH_AFTER_MS
      ) {
        candidates.add(row.p.mailboxRef);
      }
    }
  }
  const synced = new Set(
    mailboxRows
      .filter((r) => r.p.kind === 'initial_sync.fetchAndStoreMetadata_done')
      .map((r) => r.p.messagesSynced),
  );
  const confirmed = [...candidates].filter((ref) =>
    initialWorkerRows.some(
      (r) =>
        r.p.kind === 'worker.succeeded' &&
        r.p.mailboxRef === ref &&
        synced.has(r.p.result?.messagesSynced),
    ),
  );
  if (confirmed.length === 1)
    return { ref: confirmed[0], reason: 'time match + messagesSynced match' };
  if (candidates.size === 1 && confirmed.length === 0) {
    return { ref: [...candidates][0], reason: 'time match only (no scan has succeeded)' };
  }
  if (candidates.size === 0) {
    return { ref: null, reason: 'no InitialSyncWorker start logged beside the scan' };
  }
  return { ref: null, reason: `${candidates.size} scans started in the same instant — ambiguous` };
}

/** One scan's attempts, up to (and including) its terminal outcome, as numbers. */
function summarizeScan(rows, terminal, initialWorkerRows, quota) {
  const of = (kind) => rows.filter((r) => r.p.kind === `initial_sync.${kind}`);
  const begins = of('stage_begin').filter((r) => r.p.stage === 'fetching_metadata');
  const startedAt = (begins[0] ?? rows[0]).ts;
  const endMs = terminal ? t(terminal) : Infinity;
  const listDone = of('listMessageIds_loop_done').at(-1);
  const fetchBegin = of('fetch_loop_begin').at(-1);
  const fetchDone = of('fetch_loop_done').at(-1);
  const stored = of('fetchAndStoreMetadata_done').at(-1);
  const flushes = of('fetch_flush');

  // Pace from the final attempt only; an earlier attempt may have died mid-burst.
  let fetchMinutes = null;
  let perMinute = null;
  if (fetchBegin && fetchDone && t(fetchDone) >= t(fetchBegin)) {
    fetchMinutes = (t(fetchDone) - t(fetchBegin)) / 60_000;
    perMinute = fetchMinutes > 0 ? fetchBegin.p.toFetch / fetchMinutes : null;
  } else {
    const current = fetchBegin ? flushes.filter((r) => t(r) >= t(fetchBegin)) : [];
    const [first, last] = [current[0], current.at(-1)];
    const minutes = first && last ? (t(last) - t(first)) / 60_000 : 0;
    perMinute = minutes > 0 ? (last.p.processed - first.p.processed) / minutes : null;
  }

  let paceNote = null;
  if (!quota) paceNote = 'quota pace unknown';
  else if (!quota.since) paceNote = 'quota config date unknown';
  else if (Date.parse(startedAt) < Date.parse(quota.since))
    paceNote = 'ran under older quota settings';
  const expectedPerMinute = paceNote ? null : quota.unitsPerMin / quota.messagesGetCost;
  const listBegin = listDone ? begins.filter((b) => t(b) <= t(listDone)).at(-1) : null;

  return {
    startedAt,
    attempts: Math.max(begins.length, 1),
    failures: initialWorkerRows.filter(
      (r) => r.p.kind === 'worker.failed' && t(r) >= Date.parse(startedAt) && t(r) <= endMs,
    ).length,
    listed: listDone?.p.enumeratedIds ?? null,
    listSeconds: listDone && listBegin ? (t(listDone) - t(listBegin)) / 1000 : null,
    // Both cumulative: `processed` counts messages stored by earlier attempts too.
    read: stored?.p.messagesSynced ?? flushes.at(-1)?.p.processed ?? null,
    total: fetchBegin?.p.total ?? flushes.at(-1)?.p.total ?? listDone?.p.enumeratedIds ?? null,
    fetchMinutes,
    perMinute,
    expectedPerMinute,
    expectedMinutes:
      expectedPerMinute && fetchBegin ? fetchBegin.p.toFetch / expectedPerMinute : null,
    paceNote,
    unreadable: fetchDone?.p.unreadable ?? null,
    // `getProfile` is the scan's first Gmail call. Never succeeding across
    // every attempt points at access (scopes, revoked grant), not flakiness.
    firstGmailCallOk: of('getProfile_done').length > 0,
    lastProgressAt: rows.at(-1).ts,
    readyAt: terminal?.p.kind === 'worker.succeeded' ? terminal.ts : null,
    gaveUpAt: terminal?.p.kind === 'worker.dead_lettered' ? terminal.ts : null,
    result: terminal?.p.kind === 'worker.succeeded' ? (terminal.p.result ?? null) : null,
    finalAttempt: terminal?.p.attempt ?? null,
  };
}

/**
 * One entry per SCAN, not per attempt. A BullMQ retry re-logs `stage_begin`,
 * so a scan is every attempt up to its terminal outcome (`succeeded` or
 * `dead_lettered`): a row belongs to the first outcome at or after it.
 * Without a ref there are no outcomes, and every attempt lands in one scan.
 */
function scanRuns(mailboxRows, workerRows, quota) {
  const initial = workerRows.filter((r) => r.p.worker === 'InitialSyncWorker');
  const terminals = initial.filter((r) => TERMINAL.has(r.p.kind));
  const groups = new Map();
  for (const row of mailboxRows.filter((r) => r.p.kind.startsWith('initial_sync.'))) {
    const index = terminals.filter((x) => t(x) < t(row)).length;
    if (!groups.has(index)) groups.set(index, []);
    groups.get(index).push(row);
  }
  return [...groups.entries()].map(([index, rows]) =>
    summarizeScan(rows, terminals[index] ?? null, initial, quota),
  );
}

function workerTotals(workerRows) {
  const totals = new Map();
  for (const row of workerRows) {
    const name = row.p.worker;
    if (!name) continue;
    const w = totals.get(name) ?? {
      started: 0,
      succeeded: 0,
      failed: 0,
      retried: 0,
      deadLettered: 0,
      maxAttempt: 0,
      affected: 0,
      longest: null,
    };
    if (row.p.kind === 'worker.started') w.started += 1;
    if (row.p.kind === 'worker.succeeded') w.succeeded += 1;
    if (row.p.kind === 'worker.failed') w.failed += 1;
    if (row.p.kind === 'worker.retried') w.retried += 1;
    if (row.p.kind === 'worker.dead_lettered') w.deadLettered += 1;
    w.maxAttempt = Math.max(w.maxAttempt, row.p.attempt ?? 0);
    if (row.p.kind === 'worker.succeeded') {
      w.affected += row.p.result?.affectedCount ?? 0;
      if ((row.p.durationMs ?? 0) > (w.longest?.durationMs ?? 0)) {
        w.longest = { durationMs: row.p.durationMs, at: row.ts, result: row.p.result ?? null };
      }
    }
    totals.set(name, w);
  }
  return totals;
}

/** Terminal action-job lines grouped into bursts of activity. */
function actionBursts(workerRows) {
  const terminal = workerRows.filter(
    (r) => ACTION_WORKERS.has(r.p.worker) && TERMINAL.has(r.p.kind),
  );
  const retriedJobs = new Set(
    workerRows
      .filter((r) => ACTION_WORKERS.has(r.p.worker) && r.p.kind === 'worker.retried')
      .map((r) => r.p.jobRef),
  );
  const bursts = [];
  for (const row of terminal) {
    const last = bursts.at(-1);
    if (!last || t(row) - Date.parse(last.to) > BURST_GAP_MS) {
      bursts.push({
        from: row.ts,
        to: row.ts,
        workers: new Set(),
        jobs: 0,
        affected: 0,
        retried: 0,
        deadLettered: 0,
      });
    }
    const burst = bursts.at(-1);
    burst.to = row.ts;
    burst.workers.add(row.p.worker);
    burst.jobs += 1;
    burst.affected += row.p.result?.affectedCount ?? 0;
    if (retriedJobs.has(row.p.jobRef)) burst.retried += 1;
    if (row.p.kind === 'worker.dead_lettered') burst.deadLettered += 1;
  }
  return bursts;
}

/** Every signal this report can raise, from rows already fetched. */
export function summarize({ mailboxRows, workerRows, quota, ref, now = Date.now() }) {
  const scans = scanRuns(mailboxRows, workerRows, quota);
  const workers = workerTotals(workerRows);
  const bursts = actionBursts(workerRows);
  const lockFails = mailboxRows.filter((r) => r.p.kind === 'mailbox_lock.acquire_failed');
  const poolWaits = mailboxRows.filter((r) => r.p.kind === 'mailbox_lock.pool_wait');
  const incFails = mailboxRows.filter((r) => r.p.kind === 'worker.incremental.terminal_failed');
  const stuck = mailboxRows.filter((r) => r.p.kind === 'mailbox.stuck_unnoticed');
  const incOk = workerRows.filter(
    (r) => r.p.worker === 'IncrementalSyncWorker' && r.p.kind === 'worker.succeeded',
  );
  const emails = workerRows
    .filter((r) => r.p.worker === 'EmailSendWorker' && r.p.kind === 'worker.succeeded')
    .map((r) => ({
      at: r.ts,
      // Older worker versions logged no `kind`; say so instead of printing "?".
      kind: r.p.result?.kind ?? '(kind not logged)',
      outcome: r.p.result?.outcome ?? '(outcome not logged)',
    }));
  // Recommendation runs, tied to the mailbox by ref — firmer than timing
  // `reasoning.adapter_error` lines, which carry no mailbox at all.
  const scoring = workerRows
    .filter((r) => r.p.worker === 'ScoreWorker' && r.p.kind === 'worker.succeeded')
    .map((r) => ({
      at: r.ts,
      durationMs: r.p.durationMs ?? null,
      decisions: r.p.result?.decisionsWritten ?? 0,
      llm: r.p.result?.llmExplanations ?? 0,
      template: r.p.result?.templateExplanations ?? 0,
    }));
  // Every other line that names this mailbox. A worker's own failure line
  // carries only an error class; the provider's reason (a Gmail 403
  // `insufficientPermissions`, say) has turned up on a different worker's
  // line for the same mailbox — so count them all and point at them.
  const otherKinds = new Map();
  for (const row of mailboxRows) {
    if (SUMMARIZED_KIND.test(row.p.kind)) continue;
    const k = otherKinds.get(row.p.kind) ?? { count: 0, first: row.ts, last: row.ts };
    k.count += 1;
    k.last = row.ts;
    otherKinds.set(row.p.kind, k);
  }

  const flags = [];
  const flag = (severity, code, detail) => flags.push({ severity, code, detail });
  for (const [kind, k] of otherKinds) {
    if (/fail|error/i.test(kind)) {
      flag(
        'ops',
        'OTHER_FAILURES',
        `${kind} ×${k.count} (${stamp(k.first)} → ${stamp(k.last)}) — read one line: it may name the provider's reason`,
      );
    }
  }

  for (const scan of scans) {
    const at = `scan started ${stamp(scan.startedAt)}`;
    if (scan.gaveUpAt) {
      flag(
        'user',
        'SCAN_FAILED',
        `${at} gave up ${stamp(scan.gaveUpAt)} after ${scan.attempts} attempt(s)` +
          (scan.firstGmailCallOk
            ? ''
            : ' — its first Gmail call never succeeded: suspect access, read the OTHER lines'),
      );
    }
    if (!scan.readyAt && !scan.gaveUpAt && now - Date.parse(scan.lastProgressAt) > STALLED_MS) {
      flag('user', 'SCAN_STALLED', `${at}: no progress since ${stamp(scan.lastProgressAt)}`);
    }
    if (scan.attempts > 1 || scan.failures > 0) {
      flag('ops', 'SCAN_RETRIED', `${at}: ${scan.attempts} attempt(s), ${scan.failures} failed`);
    }
    if (
      scan.perMinute != null &&
      scan.expectedPerMinute != null &&
      scan.perMinute < 0.8 * scan.expectedPerMinute
    ) {
      flag(
        'user',
        'SCAN_SLOWER_THAN_QUOTA',
        `${at}: ${Math.round(scan.perMinute)}/min vs configured pace ${Math.round(scan.expectedPerMinute)}/min`,
      );
    }
    if (scan.fetchMinutes != null && scan.fetchMinutes > 10) {
      flag(
        'user',
        'SCAN_LONG_WAIT',
        `${at}: ${scan.fetchMinutes.toFixed(1)} min reading email details at the configured pace (not necessarily Gmail's ceiling — check the quota meters)`,
      );
    }
    if (
      scan.readyAt &&
      !emails.some(
        (e) =>
          e.kind === 'sync-complete' &&
          e.outcome === 'sent' &&
          Date.parse(e.at) >= Date.parse(scan.readyAt),
      )
    ) {
      flag(
        'user',
        'READY_EMAIL_MISSING',
        `no sync-complete email sent after ready ${stamp(scan.readyAt)}`,
      );
    }
  }
  const retriedActions = bursts.reduce((n, b) => n + b.retried, 0);
  if (retriedActions > 0)
    flag('user', 'ACTION_RETRIED', `${retriedActions} action job(s) needed a retry`);
  if (lockFails.length > 0) {
    // The timeout line names no worker. It is the user's problem only when
    // one of their own action jobs had to retry; otherwise background jobs waited.
    flag(
      retriedActions > 0 ? 'user' : 'ops',
      'LOCK_TIMEOUTS',
      `${lockFails.length} mailbox-lock timeouts ${stamp(lockFails[0].ts)} → ${stamp(lockFails.at(-1).ts)} (line names no job; ACTION_RETRIED counts the user's)`,
    );
  }
  const firstReady = scans.find((s) => s.readyAt)?.readyAt;
  for (const run of scoring) {
    if (run.decisions >= 10 && run.llm === 0) {
      flag(
        'user',
        'LLM_OFF',
        `${run.decisions} recommendations ${stamp(run.at)}, 0 from the LLM — every reason is a template; check reasoning.adapter_error`,
      );
    }
  }
  const firstBigRun = scoring.find(
    (run) => firstReady && Date.parse(run.at) >= Date.parse(firstReady) && run.decisions >= 10,
  );
  if (firstBigRun && Date.parse(firstBigRun.at) - Date.parse(firstReady) > 60_000) {
    flag(
      'user',
      'RECS_LATE',
      `recommendations finished ${Math.round((Date.parse(firstBigRun.at) - Date.parse(firstReady)) / 1000)}s after "ready" — the ready email lands before them`,
    );
  }
  for (const [name, w] of workers) {
    if (w.deadLettered > 0)
      flag('ops', 'DEAD_LETTERED', `${name}: ${w.deadLettered} job(s) gave up`);
    if (name !== 'InitialSyncWorker' && (w.longest?.durationMs ?? 0) > LONG_JOB_MS) {
      flag(
        'ops',
        'LONG_JOB',
        `${name} ran ${(w.longest.durationMs / 1000).toFixed(0)}s, ended ${stamp(w.longest.at)}`,
      );
    }
  }
  if (incFails.length > 0) {
    const lastFail = t(incFails.at(-1));
    const recovered = incOk.some((r) => t(r) > lastFail);
    flag(
      recovered ? 'ops' : 'user',
      recovered ? 'INCREMENTAL_FAILED_RECOVERED' : 'INCREMENTAL_FAILING',
      `${incFails.length} terminal sync failure(s), last ${stamp(incFails.at(-1).ts)}${recovered ? ' — a later sync succeeded' : ' — no success since'}`,
    );
  }
  if (stuck.length > 0) {
    const reasons = [...new Set(stuck.map((r) => r.p.reason))].join(', ');
    flag(
      'user',
      'STUCK_UNNOTICED',
      `watchdog flagged it ${stuck.length}${stuck.length >= WATCHDOG_LIMIT ? '+' : ''}× (${reasons}), last ${stamp(stuck.at(-1).ts)}`,
    );
  }
  if (scans.some((s) => s.readyAt) && bursts.length === 0 && ref) {
    flag('product', 'NO_ACTIONS_YET', 'scan finished; no action jobs since');
  }

  const status =
    mailboxRows.length === 0 && workerRows.length === 0
      ? 'UNVERIFIED'
      : flags.length === 0
        ? 'NO FLAGS'
        : 'FLAGS';
  return {
    status,
    scans,
    workers,
    bursts,
    emails,
    scoring,
    otherKinds,
    lockFails,
    poolWaits,
    incOk,
    flags,
  };
}

const n = (x) => (x == null ? '?' : Math.round(x).toLocaleString('en-US'));

export function render({ mailboxId, since, until, refInfo, summary, truncated }) {
  const out = [];
  out.push(
    `Mailbox ${mailboxId} · ${since} → ${until ?? 'now'} · ref ${refInfo.ref ?? 'none'} (${refInfo.reason})`,
  );
  if (!refInfo.ref)
    out.push(
      '⚠ no ref: worker lines unread, so no actions, emails or retries below, and scan attempts are not split',
    );
  if (truncated.length)
    out.push(
      `⚠ TRUNCATED at ${QUERY_LIMIT} rows: ${truncated.join(', ')} — narrow --since/--until`,
    );
  out.push(`STATUS ${summary.status}`);
  if (summary.status === 'UNVERIFIED') {
    out.push(
      'No log lines for this mailbox in the window. Wrong id, or older than log retention (~30d). Nothing here is evidence of health.',
    );
    return out.join('\n');
  }

  out.push('\nSCANS');
  if (summary.scans.length === 0) out.push('  no initial sync in this window');
  summary.scans.forEach((s, i) => {
    out.push(
      `  #${i + 1} started ${stamp(s.startedAt)} · ${s.attempts} attempt(s)` +
        (s.listed != null ? ` · listed ${n(s.listed)} in ${n(s.listSeconds)}s` : ''),
    );
    const pace = s.paceNote
      ? ` (${s.paceNote})`
      : ` (configured pace ${n(s.expectedPerMinute)}/min → ${n(s.expectedMinutes)} min)`;
    if (s.read != null || s.perMinute != null) {
      out.push(
        `     read ${n(s.read)} of ${n(s.total)} at ${n(s.perMinute)}/min${pace}` +
          (s.fetchMinutes != null
            ? ` · ${s.fetchMinutes.toFixed(1)} min · unreadable ${n(s.unreadable)}`
            : ''),
      );
    }
    if (s.readyAt) {
      const stages = Object.entries(s.result?.stageTimings ?? {})
        .map(([k, ms]) => `${k} ${(ms / 1000).toFixed(0)}s`)
        .join(', ');
      out.push(
        `     READY ${stamp(s.readyAt)} · ${n(s.result?.sendersIndexed)} senders · ${stages}`,
      );
    } else if (s.gaveUpAt) {
      out.push(`     GAVE UP ${stamp(s.gaveUpAt)} · ${s.failures} failed attempt(s)`);
    } else {
      out.push(`     no outcome yet · last progress ${stamp(s.lastProgressAt)}`);
    }
  });

  out.push('\nEMAIL');
  if (summary.emails.length === 0) out.push('  none sent in window');
  for (const e of summary.emails) out.push(`  ${stamp(e.at)} ${e.kind} → ${e.outcome}`);

  out.push('\nRECOMMENDATIONS (scoring runs)');
  if (summary.scoring.length === 0) out.push('  none in window');
  for (const r of summary.scoring) {
    out.push(
      `  ${stamp(r.at)} ${n(r.decisions)} written · ${n(r.llm)} LLM · ${n(r.template)} template` +
        (r.durationMs != null ? ` · ${(r.durationMs / 1000).toFixed(0)}s` : ''),
    );
  }

  out.push('\nACTIONS (jobs a click or rule caused)');
  if (summary.bursts.length === 0) out.push('  none');
  for (const b of summary.bursts) {
    out.push(
      `  ${stamp(b.from)}–${b.to.slice(11, 19)} ${[...b.workers].join('+')} ×${b.jobs} · ${n(b.affected)} emails` +
        (b.retried ? ` · ${b.retried} needed a retry` : '') +
        (b.deadLettered ? ` · ${b.deadLettered} GAVE UP` : ''),
    );
  }

  out.push('\nWORKERS');
  for (const [name, w] of summary.workers) {
    out.push(
      `  ${name}: ${w.started} started · ${w.succeeded} ok · ${w.failed} failed · ${w.deadLettered} gave up · max attempt ${w.maxAttempt}` +
        (w.longest ? ` · longest ${(w.longest.durationMs / 1000).toFixed(1)}s` : ''),
    );
  }
  out.push(
    `  mailbox-lock timeouts ${summary.lockFails.length} · lock-pool waits ${summary.poolWaits.length}`,
  );

  if (summary.otherKinds.size > 0) {
    out.push('\nOTHER LINES NAMING THIS MAILBOX (read one of each for the reason)');
    for (const [kind, k] of summary.otherKinds) {
      out.push(`  ${kind} ×${k.count} · ${stamp(k.first)} → ${stamp(k.last)}`);
    }
  }

  out.push('\nFLAGS');
  if (summary.flags.length === 0) out.push('  none');
  for (const f of summary.flags) out.push(`  [${f.severity}] ${f.code} — ${f.detail}`);
  return out.join('\n');
}

function parseArgs(argv) {
  const flags = new Map();
  const positional = [];
  for (const arg of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) flags.set(match[1], match[2]);
    else positional.push(arg);
  }
  const mailboxId = positional[0];
  // Interpolated into a Cloud Logging filter — accept only the exact shapes.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mailboxId ?? '')) {
    console.error(
      'usage: node scripts/journey-logs.mjs <mailboxAccountId uuid> [--since=ISO] [--until=ISO] [--ref=ref_…]',
    );
    process.exit(2);
  }
  const iso = (value, name) => {
    if (value === undefined) return undefined;
    const ms = Date.parse(value);
    if (Number.isNaN(ms)) {
      console.error(`--${name} is not a date: ${value}`);
      process.exit(2);
    }
    return new Date(ms).toISOString();
  };
  const ref = flags.get('ref');
  if (ref !== undefined && !/^ref_[0-9a-f]{24}$/.test(ref)) {
    console.error(`--ref must look like ref_<24 hex>, got ${ref}`);
    process.exit(2);
  }
  return {
    mailboxId,
    since: iso(flags.get('since'), 'since') ?? new Date(Date.now() - 30 * 86_400_000).toISOString(),
    until: iso(flags.get('until'), 'until'),
    ref,
    project: flags.get('project') ?? 'declutrmail-ai-prod',
  };
}

function readLogs(filter, project, limit = QUERY_LIMIT) {
  let raw;
  try {
    raw = execFileSync(
      'gcloud',
      ['logging', 'read', filter, `--project=${project}`, `--limit=${limit}`, '--format=json'],
      { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (err) {
    console.error(
      `✗ gcloud logging read failed — the logs could NOT be checked (not a clean result).\n${err.stderr ?? err.message}`,
    );
    process.exit(2);
  }
  return JSON.parse(raw || '[]');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const window =
    `resource.type="cloud_run_revision" AND timestamp>="${args.since}"` +
    (args.until ? ` AND timestamp<="${args.until}"` : '');
  const truncated = [];
  const read = (label, filter) => {
    const entries = readLogs(`${window} AND ${filter}`, args.project);
    if (entries.length >= QUERY_LIMIT) truncated.push(label);
    return normalize(entries);
  };

  // Scan progress lines are split off so a 250k-message scan's flushes
  // cannot crowd everything else out of one query's row limit.
  const scanRows = read(
    'scan',
    `jsonPayload.mailboxAccountId="${args.mailboxId}" AND jsonPayload.kind:"initial_sync."`,
  );
  const otherRows = read(
    'mailbox',
    `jsonPayload.mailboxAccountId="${args.mailboxId}" AND NOT jsonPayload.kind:"initial_sync." AND NOT jsonPayload.kind:"gmail.getClient" AND NOT jsonPayload.kind="mailbox.stuck_unnoticed"`,
  );
  const watchdogRows = normalize(
    readLogs(
      `${window} AND jsonPayload.mailboxAccountId="${args.mailboxId}" AND jsonPayload.kind="mailbox.stuck_unnoticed"`,
      args.project,
      WATCHDOG_LIMIT,
    ),
  );
  const mailboxRows = [...scanRows, ...otherRows, ...watchdogRows].sort((a, b) => t(a) - t(b));

  let refInfo = { ref: args.ref ?? null, reason: 'given with --ref' };
  if (!args.ref) {
    const begins = mailboxRows.filter((r) => r.p.kind === 'initial_sync.stage_begin');
    let initialWorkerRows = [];
    if (begins.length > 0) {
      const from = new Date(t(begins[0]) - 60_000).toISOString();
      initialWorkerRows = normalize(
        readLogs(
          `resource.type="cloud_run_revision" AND timestamp>="${from}"` +
            (args.until ? ` AND timestamp<="${args.until}"` : '') +
            ' AND jsonPayload.worker="InitialSyncWorker"',
          args.project,
        ),
      );
    }
    refInfo = deriveMailboxRef(mailboxRows, initialWorkerRows);
  }
  const workerRows = refInfo.ref ? read('workers', `jsonPayload.mailboxRef="${refInfo.ref}"`) : [];

  const summary = summarize({ mailboxRows, workerRows, quota: readQuota(), ref: refInfo.ref });
  console.log(
    render({
      mailboxId: args.mailboxId,
      since: args.since,
      until: args.until,
      refInfo,
      summary,
      truncated,
    }),
  );
  process.exit(summary.status === 'UNVERIFIED' ? 3 : summary.flags.length > 0 ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
