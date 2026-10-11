import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppException } from '../../common/app-exception.js';
import {
  describeRehearsalFailure,
  formatRehearsalExit,
  formatRehearsalFailure,
  installRehearsalFailureHandlers,
  noteRehearsalActionFailure,
  rehearsalOutcome,
  runOnce,
  type RehearsalActionFailure,
} from '../../../scripts/helpers/rehearsal-failure.js';

const SECRET = 'test_SYNTHETIC_SECRET_123';
const apiRoot = resolve(import.meta.dirname, '../../..');
const child = resolve(import.meta.dirname, 'fixtures/rehearsal-failure-child.ts');

function runChild(mode: string) {
  const reportPath = join(mkdtempSync(join(tmpdir(), 'rehearsal-failure-')), 'report.json');
  const result = spawnSync(
    process.execPath,
    ['--import', '@swc-node/register/esm-register', child, mode, reportPath],
    { cwd: apiRoot, encoding: 'utf8', timeout: 30_000 },
  );
  const report = existsSync(reportPath)
    ? (JSON.parse(readFileSync(reportPath, 'utf8')) as Record<string, unknown>)
    : null;
  return { status: result.status, stderr: result.stderr, stdout: result.stdout, report };
}

describe('describeRehearsalFailure', () => {
  it('names a thrown undefined instead of printing a bare value', () => {
    expect(describeRehearsalFailure(undefined, 'unhandled_rejection')).toEqual({
      source: 'unhandled_rejection',
      category: 'non_error_value',
      code: 'undefined',
      message: 'A non-Error value was thrown or rejected',
      stack: [],
    });
    expect(describeRehearsalFailure(null, 'main').code).toBe('null');
    expect(describeRehearsalFailure(SECRET, 'main')).toMatchObject({ code: 'string' });
    expect(JSON.stringify(describeRehearsalFailure(SECRET, 'main'))).not.toContain(SECRET);
  });

  it('keeps script assertion sentences and their frames, never the message line', () => {
    const failure = describeRehearsalFailure(new Error('Operator gate unconfirmed'), 'main');
    expect(failure).toMatchObject({ category: 'assertion', message: 'Operator gate unconfirmed' });
    expect(failure.stack.length).toBeGreaterThan(0);
    expect(failure.stack.every((frame) => frame.startsWith('at '))).toBe(true);
    expect(failure.stack.join('\n')).not.toContain('Operator gate unconfirmed');
    expect(failure.stack.join('\n')).not.toContain(apiRoot);
  });

  it.each([
    ['a token', `Bearer ${SECRET}`],
    ['an email', 'Rejected user@example.test'],
    ['a URL', 'Failed https://adelaide.trycloudflare.com/pay'],
    ['an id', 'Unknown txn_01m4mvvfh141p9py7f78ssjvxe'],
    ['a SQL value', 'duplicate key value violates unique constraint "users_email_key"'],
  ])('redacts a message containing %s', (_label, message) => {
    const failure = describeRehearsalFailure(new Error(message), 'main');
    expect(failure).toMatchObject({ category: 'unknown', message: 'redacted' });
    expect(JSON.stringify(failure)).not.toContain(message);
  });

  it('categorises provider, database, network and timeout failures by fixed codes', () => {
    expect(
      describeRehearsalFailure(new AppException({ code: 'BILLING_PROVIDER_ERROR' }), 'action'),
    ).toMatchObject({
      category: 'provider_error',
      code: 'BILLING_PROVIDER_ERROR',
      message: 'redacted',
    });
    expect(describeRehearsalFailure(new Error('sandbox_http_401'), 'main')).toMatchObject({
      category: 'provider_http',
      code: '401',
    });
    const pgError = Object.assign(new Error(`Key (email)=(${SECRET}) exists`), {
      name: 'PostgresError',
      code: '23505',
    });
    expect(describeRehearsalFailure(pgError, 'main')).toMatchObject({
      category: 'database',
      code: '23505',
      message: 'redacted',
    });
    const network = new TypeError('fetch failed', {
      cause: Object.assign(new Error(SECRET), { code: 'ECONNRESET' }),
    });
    expect(describeRehearsalFailure(network, 'main')).toMatchObject({
      category: 'network',
      code: 'ECONNRESET',
    });
    expect(
      describeRehearsalFailure(new DOMException('The operation timed out', 'TimeoutError'), 'main'),
    ).toMatchObject({ category: 'timeout', code: 'TimeoutError' });
  });

  it('formats one greppable line with phase and category', () => {
    const line = formatRehearsalFailure(
      describeRehearsalFailure(undefined, 'uncaught_exception'),
      'awaiting_synthetic_browser',
    );
    expect(line).toBe(
      'rehearsal.failed source=uncaught_exception phase=awaiting_synthetic_browser category=non_error_value code=undefined message="A non-Error value was thrown or rejected"',
    );
  });
});

describe('noteRehearsalActionFailure', () => {
  it('names only allowlisted actions and cases, and stays bounded', () => {
    const failures: RehearsalActionFailure[] = [];
    const log = vi.fn();
    const allowed = { paths: ['/prepare'], cases: ['cancel'] };
    noteRehearsalActionFailure(
      failures,
      '/prepare?case=cancel',
      new AppException({ code: 'BILLING_PROVIDER_ERROR' }),
      allowed,
      log,
    );
    noteRehearsalActionFailure(failures, `/${SECRET}?case=${SECRET}`, undefined, allowed, log);
    expect(failures).toEqual([
      {
        source: 'action',
        category: 'provider_error',
        code: 'BILLING_PROVIDER_ERROR',
        message: 'redacted',
        action: '/prepare',
        scenario: 'cancel',
      },
      expect.objectContaining({ action: 'other', scenario: 'none', category: 'non_error_value' }),
    ]);
    expect(log.mock.calls[0]![0]).toBe(
      'rehearsal.action_failed action=/prepare case=cancel category=provider_error code=BILLING_PROVIDER_ERROR message="redacted"',
    );
    expect(JSON.stringify([failures, log.mock.calls])).not.toContain(SECRET);
    for (let i = 0; i < 30; i++) noteRehearsalActionFailure(failures, '/', undefined, allowed, log);
    expect(failures).toHaveLength(20);
  });
});

describe('rehearsalOutcome', () => {
  it('reports the 38119363296 shape as aborted with the unverified cleanup named', () => {
    const verdict = rehearsalOutcome({
      finished: false,
      aborted: true,
      error: undefined,
      cleanup: {
        capabilityRecoveryVerified: true,
        tokenRevoked: true,
        attemptsRecovered: false,
        providerRecoveryVerified: false,
      },
    });
    expect(verdict).toEqual({
      outcome: 'aborted',
      unverifiedCleanup: ['attemptsRecovered', 'providerRecoveryVerified'],
    });
    expect(formatRehearsalExit(verdict, 'awaiting_synthetic_browser')).toBe(
      'rehearsal.exit outcome=aborted phase=awaiting_synthetic_browser unverified_cleanup=attemptsRecovered,providerRecoveryVerified',
    );
  });

  it('never reports a pass with a false cleanup flag, an error, or an unfinished run', () => {
    const base = { finished: true, aborted: undefined, error: undefined };
    expect(rehearsalOutcome({ ...base, cleanup: { tokenRevoked: true } }).outcome).toBe('passed');
    expect(rehearsalOutcome({ ...base, cleanup: { tokenRevoked: false } }).outcome).toBe(
      'cleanup_unverified',
    );
    expect(rehearsalOutcome({ ...base, error: { category: 'x' }, cleanup: {} }).outcome).toBe(
      'failed',
    );
    expect(rehearsalOutcome({ ...base, finished: false, cleanup: {} }).outcome).toBe('incomplete');
  });
});

describe('runOnce', () => {
  it('shares one cleanup run between the main path and process handlers', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const once = runOnce(fn);
    await Promise.all([once(), once()]);
    await once();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('installRehearsalFailureHandlers', () => {
  let dispose: (() => void) | undefined;
  afterEach(() => {
    dispose?.();
    process.exitCode = undefined;
  });

  it('logs the cleanup failure itself and still exits', async () => {
    const lines: string[] = [];
    const exit = vi.fn();
    const onFailure = vi.fn();
    dispose = installRehearsalFailureHandlers({
      onFailure,
      phase: () => 'catalog',
      shutdown: () => Promise.reject(new Error('Cleanup read failed')),
      log: (line) => lines.push(line),
      exit,
    });
    process.emit('uncaughtException', new Error('Catalog mismatch'));
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'uncaught_exception', message: 'Catalog mismatch' }),
    );
    expect(lines[0]).toContain('rehearsal.failed source=uncaught_exception phase=catalog');
    expect(lines.find((l) => l.startsWith('rehearsal.failed source=shutdown'))).toContain(
      'message="Cleanup read failed"',
    );
  });
});

describe('rehearsal process failure handlers (child process)', () => {
  it('turns a bare undefined rejection into a recorded, cleaned-up exit 1', () => {
    const run = runChild('undefined-rejection');
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(
      'rehearsal.failed source=unhandled_rejection phase=awaiting_synthetic_browser category=non_error_value code=undefined',
    );
    expect(run.stderr).not.toContain('UnhandledPromiseRejection');
    expect(run.report).toMatchObject({
      cleanupRuns: 1,
      errorPhase: 'awaiting_synthetic_browser',
      error: { source: 'unhandled_rejection', category: 'non_error_value', code: 'undefined' },
    });
  }, 40_000);

  it('redacts an uncaught exception message and still runs cleanup', () => {
    const run = runChild('uncaught');
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('rehearsal.failed source=uncaught_exception');
    expect(run.stderr).toContain('message="redacted"');
    expect(run.stderr + run.stdout + JSON.stringify(run.report)).not.toContain(SECRET);
    expect(run.stderr + JSON.stringify(run.report)).not.toContain('user@example.test');
    expect(run.report).toMatchObject({ cleanupRuns: 1, error: { category: 'unknown' } });
  }, 40_000);

  it('runs cleanup once when several failures arrive together', () => {
    const run = runChild('double');
    expect(run.status).toBe(1);
    expect(run.stderr.match(/rehearsal\.failed/g)).toHaveLength(2);
    expect(run.report).toMatchObject({ cleanupRuns: 1, error: { code: 'undefined' } });
  }, 40_000);

  it('exits after the cleanup bound when cleanup hangs', () => {
    const run = runChild('hung-cleanup');
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('rehearsal.cleanup_timeout');
  }, 40_000);
});
