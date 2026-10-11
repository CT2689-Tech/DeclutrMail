import { AppException } from '../../src/common/app-exception.js';

export type RehearsalFailureSource =
  'main' | 'action' | 'shutdown' | 'unhandled_rejection' | 'uncaught_exception';
export type RehearsalFailureCategory =
  | 'assertion'
  | 'provider_http'
  | 'provider_error'
  | 'database'
  | 'network'
  | 'timeout'
  | 'non_error_value'
  | 'unknown';
export interface RehearsalFailure {
  source: RehearsalFailureSource;
  category: RehearsalFailureCategory;
  code: string | null;
  message: string;
  stack: string[];
}

// Script assertions are plain sentences. Digits, punctuation like `_ : / @ = .`
// and quotes are excluded so tokens, ids, emails, URLs and SQL values never pass.
const SAFE_MESSAGE = /^[A-Za-z][A-Za-z ,'-]{0,159}$/;
const SAFE_FRAME =
  /^at (?:[\w$.<>[\] ]+ \((?:node:|file:\/\/|\/)[^\s()]+\)|(?:node:|file:\/\/|\/)[^\s()]+)$/;
const MAX_FRAMES = 12;

function frames(stack: unknown): string[] {
  if (typeof stack !== 'string') return [];
  return stack
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => SAFE_FRAME.test(line))
    .map((line) =>
      line.replace(/(?:file:\/\/)?\/[^\s()]*?\/(apps|packages|node_modules)\//g, '$1/'),
    )
    .slice(0, MAX_FRAMES);
}

/** Fixed category plus only provably non-sensitive detail; raw values never pass. */
export function describeRehearsalFailure(
  error: unknown,
  source: RehearsalFailureSource,
): RehearsalFailure {
  if (!(error instanceof Error))
    return {
      source,
      category: 'non_error_value',
      code: error === null ? 'null' : typeof error,
      message: 'A non-Error value was thrown or rejected',
      stack: [],
    };
  const stack = frames(error.stack);
  if (error instanceof AppException)
    return { source, category: 'provider_error', code: error.code, message: 'redacted', stack };
  const http = /^sandbox_http_(\d{3})$/.exec(error.message);
  if (http)
    return { source, category: 'provider_http', code: http[1]!, message: 'redacted', stack };
  if (error.name === 'PostgresError') {
    const sqlState = (error as { code?: unknown }).code;
    return {
      source,
      category: 'database',
      code: typeof sqlState === 'string' && /^[0-9A-Z]{5}$/.test(sqlState) ? sqlState : null,
      message: 'redacted',
      stack,
    };
  }
  if (error.name === 'TimeoutError' || error.name === 'AbortError')
    return { source, category: 'timeout', code: error.name, message: 'redacted', stack };
  if (error.name === 'TypeError' && error.message === 'fetch failed') {
    const cause = (error as { cause?: { code?: unknown } }).cause?.code;
    return {
      source,
      category: 'network',
      code: typeof cause === 'string' && /^[A-Z_]{1,40}$/.test(cause) ? cause : null,
      message: 'redacted',
      stack,
    };
  }
  if (error.constructor === Error && SAFE_MESSAGE.test(error.message))
    return { source, category: 'assertion', code: null, message: error.message, stack };
  return {
    source,
    category: 'unknown',
    code: /^[A-Za-z]{1,40}$/.test(error.name) ? error.name : null,
    message: 'redacted',
    stack,
  };
}

export function formatRehearsalFailure(failure: RehearsalFailure, phase: unknown): string {
  const head =
    `rehearsal.failed source=${failure.source} phase=${typeof phase === 'string' ? phase : 'unknown'}` +
    ` category=${failure.category} code=${failure.code ?? 'none'} message=${JSON.stringify(failure.message)}`;
  return [head, ...failure.stack.map((frame) => `    ${frame}`)].join('\n');
}

export type RehearsalActionFailure = Omit<RehearsalFailure, 'stack'> & {
  action: string;
  scenario: string;
};
const MAX_ACTION_FAILURES = 20;
/** Logs and appends one bounded entry; only allowlisted paths and cases are named. */
export function noteRehearsalActionFailure(
  failures: RehearsalActionFailure[],
  rawUrl: string | undefined,
  error: unknown,
  allowed: { paths: readonly string[]; cases: readonly string[] },
  log: (line: string) => void = (line) => console.error(line),
): void {
  let action = 'other',
    scenario = 'none';
  try {
    const url = new URL(rawUrl ?? '/', 'http://fixture.invalid');
    if (allowed.paths.includes(url.pathname)) action = url.pathname;
    const value = url.searchParams.get('case');
    if (value && allowed.cases.includes(value)) scenario = value;
  } catch {
    /* Unparseable URLs stay unnamed. */
  }
  const { source, category, code, message } = describeRehearsalFailure(error, 'action');
  const failure = { source, category, code, message };
  log(
    `rehearsal.action_failed action=${action} case=${scenario} category=${failure.category}` +
      ` code=${failure.code ?? 'none'} message=${JSON.stringify(failure.message)}`,
  );
  if (failures.length < MAX_ACTION_FAILURES) failures.push({ ...failure, action, scenario });
}

export type RehearsalOutcome =
  'passed' | 'aborted' | 'failed' | 'cleanup_unverified' | 'incomplete';
/** Exit verdict from recorded evidence; a false cleanup flag is never a pass. */
export function rehearsalOutcome(input: {
  finished: boolean;
  aborted: unknown;
  error: unknown;
  cleanup: Record<string, unknown>;
}): { outcome: RehearsalOutcome; unverifiedCleanup: string[] } {
  const unverifiedCleanup = Object.entries(input.cleanup)
    .filter(([, value]) => value === false)
    .map(([key]) => key)
    .sort();
  const outcome: RehearsalOutcome = input.error
    ? 'failed'
    : input.aborted === true
      ? 'aborted'
      : !input.finished
        ? 'incomplete'
        : unverifiedCleanup.length
          ? 'cleanup_unverified'
          : 'passed';
  return { outcome, unverifiedCleanup };
}

export function formatRehearsalExit(
  verdict: ReturnType<typeof rehearsalOutcome>,
  phase: unknown,
): string {
  return (
    `rehearsal.exit outcome=${verdict.outcome} phase=${typeof phase === 'string' ? phase : 'unknown'}` +
    ` unverified_cleanup=${verdict.unverifiedCleanup.join(',') || 'none'}`
  );
}

/** Concurrent and repeated callers share one cleanup run. */
export function runOnce(fn: () => Promise<void>): () => Promise<void> {
  let run: Promise<void> | undefined;
  return () => (run ??= fn());
}

/**
 * Record, log, clean up, then exit for failures outside the main try. Cleanup
 * is bounded so a hung provider call cannot keep the runner alive.
 */
export function installRehearsalFailureHandlers(options: {
  onFailure: (failure: RehearsalFailure) => void;
  phase: () => unknown;
  shutdown: () => Promise<void>;
  log?: (line: string) => void;
  exit?: (code: number) => void;
  timeoutMs?: number;
}): () => void {
  const log = options.log ?? ((line: string) => console.error(line));
  const exit = options.exit ?? ((code: number) => process.exit(code));
  let handling = false;
  const handle = (source: 'unhandled_rejection' | 'uncaught_exception') => (error: unknown) => {
    const failure = describeRehearsalFailure(error, source);
    log(formatRehearsalFailure(failure, options.phase()));
    process.exitCode = 1;
    if (handling) return;
    handling = true;
    options.onFailure(failure);
    let timer: ReturnType<typeof setTimeout> | undefined;
    void Promise.race([
      options.shutdown().catch((cleanupError: unknown) => {
        log(
          formatRehearsalFailure(
            describeRehearsalFailure(cleanupError, 'shutdown'),
            options.phase(),
          ),
        );
      }),
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          log('rehearsal.cleanup_timeout');
          resolve();
        }, options.timeoutMs ?? 120_000);
      }),
    ]).finally(() => {
      if (timer) clearTimeout(timer);
      exit(1);
    });
  };
  const onRejection = handle('unhandled_rejection');
  const onException = handle('uncaught_exception');
  process.on('unhandledRejection', onRejection);
  process.on('uncaughtException', onException);
  return () => {
    process.off('unhandledRejection', onRejection);
    process.off('uncaughtException', onException);
  };
}
