'use client';

/**
 * Lightweight browser Sentry facade.
 *
 * Next's universal client instrumentation and product features import this
 * module, so it must not statically import the SDK or telemetry scrubber. The
 * heavy runtime loads once during a bounded idle window, or immediately after
 * an exception. Tiny temporary global-error listeners cover that lazy window.
 */

/** The breadcrumb subset used by product surfaces. */
export interface AppBreadcrumb {
  category: 'sync' | 'action' | 'undo' | 'navigation' | 'mailbox' | 'auth';
  message: string;
  level: 'info' | 'warning' | 'error';
  data?: Record<string, string | number | boolean | null>;
}

export interface FeatureExceptionContext {
  surface:
    | 'sync'
    | 'senders'
    | 'activity'
    | 'brief'
    | 'autopilot'
    | 'triage'
    | 'onboarding'
    | 'quiet'
    | 'screener';
  reason: string;
}

export type EarlyGlobalExceptionSource = 'window-error' | 'unhandled-rejection';

export interface BrowserSentryRuntime {
  addBreadcrumb(crumb: AppBreadcrumb): void;
  captureFeatureException(error: unknown, context: FeatureExceptionContext): void;
  captureEarlyGlobalException(error: Error, source: EarlyGlobalExceptionSource): void;
  captureBoundaryException(error: unknown, boundary: string, digest: string | undefined): boolean;
  captureRouterTransitionStart(href: string, navigationType: string): void;
}

type BrowserSentryRuntimeModule = {
  initSentryBrowserRuntime(dsn: string): BrowserSentryRuntime;
};

type RuntimeImporter = () => Promise<BrowserSentryRuntimeModule>;

type PendingOperation =
  | { kind: 'breadcrumb'; crumb: AppBreadcrumb }
  | { kind: 'feature-exception'; error: Error; context: FeatureExceptionContext }
  | {
      kind: 'global-exception';
      error: Error;
      source: EarlyGlobalExceptionSource;
    };

const MAX_PENDING_BREADCRUMBS = 50;
const MAX_PENDING_EXCEPTIONS = 20;
const IDLE_LOAD_TIMEOUT_MS = 2_000;
const RETRY_BACKOFF_MS = 750;
const LOAD_ATTEMPT_TIMEOUT_MS = 5_000;
const MAX_LOAD_ATTEMPTS = 2;
const LOAD_FAILURE_WARNING =
  '[sentry] Browser observability failed to load; one retry will be attempted.';

let runtime: BrowserSentryRuntime | undefined;
let runtimePromise: Promise<BrowserSentryRuntime | undefined> | undefined;
let pendingOperations: PendingOperation[] = [];
let loadAttempts = 0;
let attemptsExhausted = false;
let warnedLoadFailure = false;
let earlyGlobalListenersInstalled = false;

type ScheduledLoad =
  { kind: 'idle'; handle: number } | { kind: 'timeout'; handle: ReturnType<typeof setTimeout> };

let scheduledLoad: ScheduledLoad | undefined;
let retryHandle: ReturnType<typeof setTimeout> | undefined;

const defaultRuntimeImporter: RuntimeImporter = () => import('./sentry-browser-runtime');
let runtimeImporter: RuntimeImporter = defaultRuntimeImporter;

type WindowWithIdleCallback = Window & {
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout?: number | undefined },
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
};

function configuredDsn(): string | undefined {
  return process.env.NEXT_PUBLIC_SENTRY_DSN || undefined;
}

function canLoadBrowserRuntime(): boolean {
  return typeof window !== 'undefined' && configuredDsn() !== undefined && !attemptsExhausted;
}

function isExceptionOperation(operation: PendingOperation): boolean {
  return operation.kind !== 'breadcrumb';
}

function enqueueOperation(operation: PendingOperation): void {
  const sameKind =
    operation.kind === 'breadcrumb'
      ? (candidate: PendingOperation) => candidate.kind === 'breadcrumb'
      : isExceptionOperation;
  const limit = operation.kind === 'breadcrumb' ? MAX_PENDING_BREADCRUMBS : MAX_PENDING_EXCEPTIONS;

  if (pendingOperations.filter(sameKind).length >= limit) {
    const oldestSameKind = pendingOperations.findIndex(sameKind);
    if (oldestSameKind >= 0) pendingOperations.splice(oldestSameKind, 1);
  }
  pendingOperations.push(operation);
}

function boundedErrorField(value: unknown, limit: number, fallback: string): string {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  return value.slice(0, limit);
}

function readBoundedErrorField(
  error: Error,
  field: 'name' | 'message' | 'stack',
  limit: number,
  fallback: string,
): string {
  try {
    return boundedErrorField(error[field], limit, fallback);
  } catch {
    return fallback;
  }
}

function safeBufferedError(error: unknown): Error {
  if (error instanceof Error) {
    // Snapshot only approved, bounded scalar fields. Error subclasses often
    // attach `body`, `response`, `cause`, or cyclic request graphs; retaining
    // the original object through a lazy import would retain all of them.
    const message = readBoundedErrorField(error, 'message', 1_024, 'Error');
    const name = readBoundedErrorField(error, 'name', 120, 'Error');
    const stack = readBoundedErrorField(error, 'stack', 8_192, `${name}: ${message}`);
    const snapshot = new Error(message);
    snapshot.name = name;
    snapshot.stack = stack;
    return snapshot;
  }

  // Never retain arbitrary rejection objects, DOM events, response payloads,
  // or their string representations while the SDK chunk is unavailable.
  const sanitized = new Error('A non-Error value reached an exception boundary.');
  sanitized.name = 'NonErrorException';
  return sanitized;
}

function cancelScheduledLoad(): void {
  if (!scheduledLoad || typeof window === 'undefined') return;

  if (scheduledLoad.kind === 'idle') {
    (window as WindowWithIdleCallback).cancelIdleCallback?.(scheduledLoad.handle);
  } else {
    clearTimeout(scheduledLoad.handle);
  }
  scheduledLoad = undefined;
}

function cancelRetry(): void {
  if (retryHandle === undefined) return;
  clearTimeout(retryHandle);
  retryHandle = undefined;
}

function clearPending(): void {
  pendingOperations = [];
}

function clearPendingExceptions(): void {
  pendingOperations = pendingOperations.filter((operation) => operation.kind === 'breadcrumb');
}

function onEarlyWindowError(event: ErrorEvent): void {
  // Resource load failures dispatch a plain Event; they are not uncaught
  // JavaScript exceptions and must not become synthetic Sentry noise.
  if (!(event instanceof ErrorEvent)) return;

  if (event.error !== undefined && event.error !== null) {
    queueEarlyGlobalException(event.error, 'window-error');
    return;
  }

  // Browsers can intentionally omit `.error` (notably cross-origin script
  // failures). Retain only a bounded summary and a query/hash-free location.
  const message = boundedErrorField(event.message, 512, 'An uncaught browser error occurred.');
  const rawLocation = boundedErrorField(event.filename, 512, '');
  const location = rawLocation.split(/[?#]/u, 1)[0] ?? '';
  const line = Number.isSafeInteger(event.lineno) ? Math.max(0, event.lineno) : 0;
  const column = Number.isSafeInteger(event.colno) ? Math.max(0, event.colno) : 0;
  const where = location
    ? ` at ${location}${line > 0 ? `:${line}${column > 0 ? `:${column}` : ''}` : ''}`
    : '';
  const snapshot = new Error(`${message}${where}`.slice(0, 1_024));
  snapshot.name = 'WindowErrorEvent';
  queueEarlyGlobalException(snapshot, 'window-error');
}

function onEarlyUnhandledRejection(event: PromiseRejectionEvent): void {
  queueEarlyGlobalException(event.reason, 'unhandled-rejection');
}

function installEarlyGlobalListeners(): void {
  if (!canLoadBrowserRuntime() || runtime || earlyGlobalListenersInstalled) return;

  window.addEventListener('error', onEarlyWindowError);
  window.addEventListener('unhandledrejection', onEarlyUnhandledRejection);
  earlyGlobalListenersInstalled = true;
}

function removeEarlyGlobalListeners(): void {
  if (!earlyGlobalListenersInstalled || typeof window === 'undefined') return;

  window.removeEventListener('error', onEarlyWindowError);
  window.removeEventListener('unhandledrejection', onEarlyUnhandledRejection);
  earlyGlobalListenersInstalled = false;
}

function queueEarlyGlobalException(error: unknown, source: EarlyGlobalExceptionSource): void {
  if (!canLoadBrowserRuntime() || runtime) return;

  enqueueOperation({
    kind: 'global-exception',
    error: safeBufferedError(error),
    source,
  });
  void loadSentryBrowserRuntime();
}

function flushPending(loadedRuntime: BrowserSentryRuntime): void {
  // Clear first: SDK calls are defensive, and an exception in observability
  // must not cause an already-attempted operation to replay twice.
  const operations = pendingOperations;
  clearPending();

  for (const operation of operations) {
    try {
      if (operation.kind === 'breadcrumb') {
        loadedRuntime.addBreadcrumb(operation.crumb);
      } else if (operation.kind === 'feature-exception') {
        loadedRuntime.captureFeatureException(operation.error, operation.context);
      } else {
        loadedRuntime.captureEarlyGlobalException(operation.error, operation.source);
      }
    } catch {
      // Observability must never break the product interaction.
    }
  }
}

function scheduleRetry(): void {
  if (retryHandle !== undefined || attemptsExhausted || runtime) return;

  retryHandle = setTimeout(() => {
    retryHandle = undefined;
    void loadSentryBrowserRuntime();
  }, RETRY_BACKOFF_MS);
}

function importRuntimeWithDeadline(): Promise<BrowserSentryRuntimeModule> {
  const importOperation = Promise.resolve().then(runtimeImporter);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      // Do not attach the original import or an Error to telemetry/log output.
      // The generic failure path below owns warning + retry behavior.
      reject(undefined);
    }, LOAD_ATTEMPT_TIMEOUT_MS);

    importOperation.then(
      (module) => {
        clearTimeout(timeout);
        resolve(module);
      },
      () => {
        clearTimeout(timeout);
        reject(undefined);
      },
    );
  });
}

async function loadSentryBrowserRuntime(): Promise<BrowserSentryRuntime | undefined> {
  const dsn = configuredDsn();
  if (typeof window === 'undefined' || !dsn || attemptsExhausted) return undefined;
  if (runtime) return runtime;
  if (runtimePromise) return runtimePromise;
  // During backoff, retain newly observed operations but do not let repeated
  // exceptions bypass the bound and create an import storm.
  if (retryHandle !== undefined) return undefined;

  cancelScheduledLoad();
  installEarlyGlobalListeners();
  loadAttempts += 1;

  const attempt = importRuntimeWithDeadline()
    .then((module) => {
      // Atomically hand global coverage to Sentry: remove the bridge on the
      // instruction immediately before its synchronous init. If init throws,
      // restore the bridge in the same stack before entering retry handling.
      removeEarlyGlobalListeners();
      try {
        const loadedRuntime = module.initSentryBrowserRuntime(dsn);
        // Publish + replay in this same callback. Sentry.init may queue app
        // microtasks; none may observe a successfully initialised SDK while the
        // facade still appears uninitialised and reinstall the temporary bridge.
        runtime = loadedRuntime;
        cancelRetry();
        flushPending(loadedRuntime);
        return loadedRuntime;
      } catch (error) {
        installEarlyGlobalListeners();
        throw error;
      }
    })
    .catch(() => {
      runtimePromise = undefined;
      // Error objects may contain messages/stacks. Do not retain them through a
      // failed chunk attempt; later events can enter the bounded retry window.
      clearPendingExceptions();
      if (!warnedLoadFailure) {
        warnedLoadFailure = true;
        console.warn(LOAD_FAILURE_WARNING);
      }

      if (loadAttempts < MAX_LOAD_ATTEMPTS) {
        scheduleRetry();
      } else {
        attemptsExhausted = true;
        cancelRetry();
        clearPending();
        removeEarlyGlobalListeners();
      }
      return undefined;
    });

  runtimePromise = attempt;
  return attempt;
}

/**
 * Install the DSN-gated error bridge and schedule one SDK load. The idle
 * callback is bounded; browsers without it use an equivalent timeout.
 */
export function scheduleSentryBrowserInit(): void {
  if (!canLoadBrowserRuntime()) return;
  installEarlyGlobalListeners();
  if (runtime || runtimePromise || scheduledLoad || retryHandle !== undefined) {
    return;
  }

  const browserWindow = window as WindowWithIdleCallback;
  if (typeof browserWindow.requestIdleCallback === 'function') {
    const handle = browserWindow.requestIdleCallback(
      () => {
        scheduledLoad = undefined;
        void loadSentryBrowserRuntime();
      },
      { timeout: IDLE_LOAD_TIMEOUT_MS },
    );
    scheduledLoad = { kind: 'idle', handle };
    return;
  }

  const handle = setTimeout(() => {
    scheduledLoad = undefined;
    void loadSentryBrowserRuntime();
  }, IDLE_LOAD_TIMEOUT_MS);
  scheduledLoad = { kind: 'timeout', handle };
}

/** Explicit init retained for existing App Router error boundaries. */
export async function initSentryBrowser(): Promise<void> {
  if (canLoadBrowserRuntime()) installEarlyGlobalListeners();
  await loadSentryBrowserRuntime();
}

/** Add a breadcrumb synchronously, retaining at most 50 before lazy init. */
export function addBreadcrumb(crumb: AppBreadcrumb): void {
  if (!canLoadBrowserRuntime()) return;
  if (runtime) {
    try {
      runtime.addBreadcrumb(crumb);
    } catch {
      // Observability must never break the product interaction.
    }
    return;
  }

  installEarlyGlobalListeners();
  enqueueOperation({ kind: 'breadcrumb', crumb });
  scheduleSentryBrowserInit();
}

/**
 * Capture a non-fatal feature exception. The public API stays synchronous; an
 * early exception is safely queued and immediately starts the lazy import.
 */
export function captureFeatureException(error: unknown, context: FeatureExceptionContext): void {
  if (!canLoadBrowserRuntime()) return;
  if (runtime) {
    try {
      runtime.captureFeatureException(error, context);
    } catch {
      // Observability must never break the product interaction.
    }
    return;
  }

  installEarlyGlobalListeners();
  enqueueOperation({
    kind: 'feature-exception',
    error: safeBufferedError(error),
    context,
  });
  void loadSentryBrowserRuntime();
}

/** Boundary bridge which reports whether capture was available. */
export async function captureSentryBoundaryException(
  error: unknown,
  boundary: string,
  digest: string | undefined,
): Promise<boolean> {
  if (canLoadBrowserRuntime()) installEarlyGlobalListeners();
  const loadedRuntime = await loadSentryBrowserRuntime();
  if (!loadedRuntime) return false;
  try {
    return loadedRuntime.captureBoundaryException(error, boundary, digest);
  } catch {
    return false;
  }
}

/**
 * Forward only transitions observed after SDK init. Pre-init timing is stale by
 * definition, so it schedules the runtime but is never replayed later.
 */
export function captureRouterTransitionStart(href: string, navigationType: string): void {
  if (!canLoadBrowserRuntime()) return;
  if (runtime) {
    try {
      runtime.captureRouterTransitionStart(href, navigationType);
    } catch {
      // Observability must never break navigation.
    }
    return;
  }

  scheduleSentryBrowserInit();
}

/** Reset lightweight module state between unit tests. */
export function __resetForTests(): void {
  cancelScheduledLoad();
  cancelRetry();
  removeEarlyGlobalListeners();
  runtime = undefined;
  runtimePromise = undefined;
  pendingOperations = [];
  loadAttempts = 0;
  attemptsExhausted = false;
  warnedLoadFailure = false;
  runtimeImporter = defaultRuntimeImporter;
}

/** Narrow dependency seam for deterministic lazy-load tests. */
export const __testing = {
  setRuntimeImporter(importer: RuntimeImporter): void {
    runtimeImporter = importer;
  },
  limits: {
    breadcrumbs: MAX_PENDING_BREADCRUMBS,
    exceptions: MAX_PENDING_EXCEPTIONS,
  },
  retryBackoffMs: RETRY_BACKOFF_MS,
  loadAttemptTimeoutMs: LOAD_ATTEMPT_TIMEOUT_MS,
};
