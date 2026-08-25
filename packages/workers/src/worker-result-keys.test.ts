import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { SAFE_WORKER_RESULT_KEYS } from './base-declutr-worker.js';

const SRC_DIR = fileURLToPath(new URL('.', import.meta.url));

/**
 * Every field a worker returns must survive to the ops line.
 *
 * `sanitizeWorkerResult` filters `worker.succeeded` through
 * `SAFE_WORKER_RESULT_KEYS`, which is a DENYLIST BY OMISSION: a key
 * absent from it is dropped with no error, no warning, and no failing
 * test. The worker keeps returning the value, every unit test that
 * reads the return value stays green, and the number simply never
 * reaches Cloud Logging.
 *
 * That is not hypothetical. It happened TWICE on 2026-08-23 alone:
 *
 *   - `SenderIndexSweepWorker.mailboxesSwept` — a nightly sweep that
 *     logged `durationMs` and `mailboxesFailed: 0` with no way to tell
 *     a clean pass from one that swept nothing. Caught only by running
 *     the worker against a real database and reading the log.
 *   - `DeadLetterWorker.unreplayedTotal` — caught before shipping only
 *     because the first one had just happened.
 *
 * The list is ~60 hand-maintained entries and nothing connected it to
 * the types. This is that connection: a static check over every
 * `*Result` interface in this package.
 *
 * Deliberately source-parsing rather than type-level: TypeScript types
 * are erased at runtime, so there is no way to enumerate an interface's
 * members from inside a test. Reading the declarations is the only
 * mechanism that can see ALL workers rather than the ones a test
 * remembers to name — and "the ones a test remembers to name" is
 * exactly the coverage that let both bugs through.
 */
function workerResultInterfaces(): Map<string, string[]> {
  const files = readdirSync(SRC_DIR).filter(
    (f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.spec.ts'),
  );

  // Only the types a worker actually RETURNS FROM A JOB reach
  // `sanitizeWorkerResult`. Internal helper shapes (`CascadeResult`,
  // `GmailWatchResult`, …) never touch the ops line, so scoping by
  // name alone would flag ~12 false positives and the guard would be
  // deleted within a week. Scope by the real contract instead: the
  // second type argument of `BaseDeclutrWorker<Payload, Result>`.
  const resultTypeNames = new Set<string>();
  const sources = new Map<string, string>();
  for (const file of files) {
    const src = readFileSync(join(SRC_DIR, file), 'utf8');
    sources.set(file, src);
    for (const m of src.matchAll(/extends BaseDeclutrWorker<\s*([\s\S]*?)>\s*\{/g)) {
      const args = m[1]!.split(',');
      const resultArg = args[args.length - 1]?.trim();
      if (resultArg && /^\w+$/.test(resultArg)) {
        resultTypeNames.add(resultArg);
      }
    }
  }

  const byInterface = new Map<string, string[]>();
  for (const [file, src] of sources) {
    for (const m of src.matchAll(/export interface (\w+)\s*\{([\s\S]*?)\n\}/g)) {
      const [, name, body] = m;
      if (!resultTypeNames.has(name!)) continue;
      const members = [...body!.matchAll(/^\s{2}(\w+)\??\s*:/gm)].map((x) => x[1]!);
      if (members.length > 0) byInterface.set(`${file}:${name}`, members);
    }
  }
  return byInterface;
}

/**
 * Fields deliberately kept OFF the ops line, with the reason.
 *
 * The allowlist is not only an observability mechanism — it is the last
 * thing standing between a worker's return value and Cloud Logging, so
 * some omissions are the point. Each entry here is a decision, not an
 * oversight, and moving one onto the allowlist means deciding that its
 * contents are safe to keep in logs indefinitely.
 */
const DELIBERATELY_NOT_LOGGED = new Map<string, string>([
  [
    'undoToken',
    'A CAPABILITY. Anyone with log access could reverse a user action ' +
      'with it (D226/D232). The action id is already logged and is the ' +
      'correct correlation key.',
  ],
  [
    'providerId',
    "The email provider's own message id. Useful for deliverability " +
      'debugging, but it is an external identifier for a message sent to ' +
      'a person; `telemetryReference()` is the hashed form if it is ever ' +
      'needed.',
  ],
]);

describe('worker result keys reach the ops line', () => {
  const interfaces = workerResultInterfaces();

  it('finds worker job-result interfaces to check', () => {
    // THE BLIND CASE, asserted first. Every assertion below is a filter
    // over this parse. If the regex stops matching — a formatting
    // change, a rename — the checks pass vacuously while checking
    // nothing, which is the same failure mode as the bug they guard.
    expect(interfaces.size).toBeGreaterThan(8);
  });

  it('has every returned field in SAFE_WORKER_RESULT_KEYS', () => {
    const missing: string[] = [];
    for (const [where, members] of interfaces) {
      for (const member of members) {
        if (!SAFE_WORKER_RESULT_KEYS.has(member) && !DELIBERATELY_NOT_LOGGED.has(member)) {
          missing.push(`${where}.${member}`);
        }
      }
    }
    // Any entry here is a metric the worker computes and the ops line
    // silently discards. Add it to SAFE_WORKER_RESULT_KEYS (integers
    // and booleans only — never anything carrying message content,
    // addresses, or subjects: D7/D228).
    expect(missing).toEqual([]);
  });

  it('keeps the deliberate exclusions genuinely excluded', () => {
    // The other direction. If someone allowlists `undoToken` to "fix"
    // the test above, this fails and says why — a capability token in
    // the logs is worse than a missing metric.
    for (const [key, reason] of DELIBERATELY_NOT_LOGGED) {
      expect(SAFE_WORKER_RESULT_KEYS.has(key), `${key} must stay off the ops line: ${reason}`).toBe(
        false,
      );
    }
  });

  it('would catch a field that is not on the allowlist', () => {
    // The guard's own negative control. Without it, a regex that
    // matched nothing would report a clean pass forever.
    expect(SAFE_WORKER_RESULT_KEYS.has('definitelyNotAnAllowlistedMetric')).toBe(false);
    const pretend = ['durationMs', 'definitelyNotAnAllowlistedMetric'];
    expect(pretend.filter((k) => !SAFE_WORKER_RESULT_KEYS.has(k))).toEqual([
      'definitelyNotAnAllowlistedMetric',
    ]);
  });
});
