// apps/api/src/adapters/llm-circuit-breaker.ts — stops LLM calls the
// provider has already refused (D24, D62).
//
// On 2026-09-24 the Anthropic balance hit zero. Every call after that
// failed with the same 400, and the score worker kept making one per
// sender, each paced through the rate limiter: 2,927 refused calls in
// 431 s for one mailbox, every recommendation reason a template, and no
// page for ~20 hours. A refusal about the ACCOUNT (credit, spend limit,
// key) repeats on every call until a person acts, so the right response
// to the first one is to stop calling and say so.
//
// One breaker is shared by every adapter on the same Anthropic account
// (the composition root wires the Haiku and Brief adapters to one
// instance), so a refusal seen by either pauses both. It lives in worker
// memory: each process pauses on its own first refusal.
//
// PRIVACY (D7, D228): the log line carries the provider's status, error
// type, structured error code and request id, each only when it is
// shaped like an identifier — never the provider's message, which could
// echo the request, and never the prompt.

/**
 * `kind` of the line logged once per refused call. The log-based metric
 * behind `scripts/setup-llm-rejection-alert.mjs` counts exactly this
 * line, and a test evaluates that script's filter against what this
 * module emits — renaming it without the script silences the page.
 */
export const LLM_PROVIDER_REJECTED_KIND = 'llm.provider_rejected';

/**
 * Why the provider refused a call — each maps to a different fix:
 *   - `credit_balance`: prepaid credits ran out → buy credits.
 *   - `spend_limit`: a spend limit WE set (org or workspace) → raise it.
 *   - `tier_spend_cap`: the usage tier's monthly cap → request a higher
 *     tier, or wait for the month to turn.
 *   - `billing_error`: payment details → fix them in the Console.
 *   - `auth`: key revoked, expired, or not permitted (401/403).
 *   - `not_found`: the model or endpoint is gone (404).
 *   - `other`: any other refusal of the request itself (4xx), including
 *     a 429 carrying an error code this classifier does not know.
 *
 * The alert script's metric label and runbook list every one of these;
 * a contract test holds them together.
 */
export const PROVIDER_REJECTION_REASONS = [
  'credit_balance',
  'spend_limit',
  'tier_spend_cap',
  'billing_error',
  'auth',
  'not_found',
  'other',
] as const;
export type ProviderRejectionReason = (typeof PROVIDER_REJECTION_REASONS)[number];

/**
 * Whether a refusal pauses calls. Everything about the account or the
 * model repeats on every call, so it pauses. `other` may be one request's
 * fault — a paused sweep for one bad request is the worse bug — so it
 * pages without pausing.
 */
const PAUSES: Record<ProviderRejectionReason, boolean> = {
  credit_balance: true,
  spend_limit: true,
  tier_spend_cap: true,
  billing_error: true,
  auth: true,
  not_found: true,
  other: false,
};

export interface ProviderRejection {
  reason: ProviderRejectionReason;
  status: number;
  type: string | null;
  /** `error.details.error_code` when the provider sent one. */
  errorCode: string | null;
  requestId: string | null;
}

/**
 * How long calls stay paused after a refusal. Long enough that a whole
 * sweep falls back to templates at once; short enough that LLM prose
 * returns within minutes of a top-up. Shorter than the alert's one-hour
 * window, so the retries of a long outage keep one incident open rather
 * than paging again each time.
 */
export const DEFAULT_LLM_COOLDOWN_MS = 15 * 60 * 1000;

export interface LlmCircuitBreakerOptions {
  cooldownMs?: number;
  /** Clock, ms since epoch. Tests inject one. */
  now?: () => number;
}

/**
 * A refusal that will repeat pauses calls for the cool-down. After it,
 * calls simply go out again: if the account still refuses, the first of
 * them re-pauses. No single probe gates the rest — callers queued behind
 * one in-flight probe finished instantly as "blocked", so the first sweep
 * after a top-up came out all templates (caught by smoke; see
 * llm-circuit-breaker.sweep.spec.ts). The cost is up to one refused call
 * per in-flight slot per cool-down, and refused calls are not billed.
 */
export class LlmCircuitBreaker {
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private pausedUntil = 0;

  constructor(options: LlmCircuitBreakerOptions = {}) {
    this.cooldownMs = options.cooldownMs ?? DEFAULT_LLM_COOLDOWN_MS;
    this.now = options.now ?? Date.now;
  }

  /** True while calls are paused. */
  isBlocked(): boolean {
    return this.now() < this.pausedUntil;
  }

  /**
   * The call threw. A provider refusal is logged as
   * `llm.provider_rejected` and, unless it is `other`, pauses calls.
   * Returns the refusal, or `null` for a transient failure (rate limit,
   * 5xx, timeout, network), which the caller reports as it always has.
   */
  recordFailure(
    err: unknown,
    source: { adapter: string; model: string },
  ): ProviderRejection | null {
    const rejection = classifyProviderRejection(err);
    if (rejection === null) return null;
    const pauses = PAUSES[rejection.reason];
    if (pauses) this.pausedUntil = this.now() + this.cooldownMs;
    console.error(
      JSON.stringify({
        level: 'error',
        kind: LLM_PROVIDER_REJECTED_KIND,
        adapter: source.adapter,
        model: source.model,
        reason: rejection.reason,
        status: rejection.status,
        type: rejection.type,
        ...(rejection.errorCode ? { errorCode: rejection.errorCode } : {}),
        requestId: rejection.requestId,
        pausedMs: pauses ? this.cooldownMs : 0,
      }),
    );
    return rejection;
  }
}

/** Provider enums (`error.type`, `error.details.error_code`). */
const PROVIDER_ID = /^[a-z][a-z0-9_]{0,63}$/;
/** Anthropic request ids (`req_…`). */
const REQUEST_ID = /^[A-Za-z0-9_-]{1,128}$/;

export type ProviderErrorFields =
  { status: number; type: string | null; requestId: string | null } | { error: string };

/**
 * What an adapter logs for a transient provider failure: status, type
 * and request id when the provider answered; only the error's class when
 * it did not. Never a message — the provider's can echo the request (the
 * Brief's holds subjects and snippets), and an error with no HTTP status,
 * such as a streamed one, carries the provider's body in its own.
 */
export function providerErrorFields(err: unknown): ProviderErrorFields {
  const status = readPath(err, ['status']);
  if (typeof status === 'number') {
    return { status, type: identifier(errorType(err), PROVIDER_ID), requestId: requestIdOf(err) };
  }
  return { error: err instanceof Error ? err.constructor.name : typeof err };
}

/**
 * Structured fields first — status, `error.type`, `error.details.
 * error_code`. The provider's wording is read only where Anthropic sends
 * different refusals under one status and type: a 400
 * `invalid_request_error` is a malformed request, an exhausted credit
 * balance, or a spend limit we set, told apart only by the message.
 */
function classifyProviderRejection(err: unknown): ProviderRejection | null {
  const status = readPath(err, ['status']);
  if (typeof status !== 'number') return null;
  // 5xx: the provider is down, not refusing. 408/409: the SDK retries.
  if (status < 400 || status >= 500 || status === 408 || status === 409) return null;
  const type = identifier(errorType(err), PROVIDER_ID);
  const errorCode = identifier(
    stringAt(err, ['error', 'error', 'details', 'error_code']),
    PROVIDER_ID,
  );
  const message = stringAt(err, ['error', 'error', 'message']) ?? '';
  const reason = refusalReason(status, type, errorCode, message);
  return reason === null ? null : { reason, status, type, errorCode, requestId: requestIdOf(err) };
}

function refusalReason(
  status: number,
  type: string | null,
  errorCode: string | null,
  message: string,
): ProviderRejectionReason | null {
  if (errorCode === 'enforced_spend_limit_reached') return 'tier_spend_cap';
  if (status === 402 || type === 'billing_error') return 'billing_error';
  // Anthropic's own sentences, matched from the start of its message so an
  // echoed snippet ("your credit balance is…") never passes for one. If the
  // wording changes, the refusal still pages, as `other`.
  if (/^Your credit balance is too low/i.test(message)) return 'credit_balance';
  if (/^You have reached your specified (workspace )?API usage limits/i.test(message)) {
    return 'spend_limit';
  }
  if (/^You have reached your API usage limits/i.test(message)) return 'tier_spend_cap';
  // A 429 is a rate limit — transient, the SDK retries it — unless it
  // carries a code this classifier does not know: then page, don't pause.
  if (status === 429) return errorCode === null ? null : 'other';
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not_found';
  return 'other';
}

function errorType(err: unknown): string | null {
  const direct = readPath(err, ['type']);
  return typeof direct === 'string' ? direct : stringAt(err, ['error', 'error', 'type']);
}

function requestIdOf(err: unknown): string | null {
  const header = readPath(err, ['requestID']);
  const id = typeof header === 'string' ? header : stringAt(err, ['error', 'request_id']);
  return identifier(id, REQUEST_ID);
}

/** A provider-supplied value, kept only if it has the shape of an identifier. */
function identifier(value: string | null, shape: RegExp): string | null {
  return value !== null && shape.test(value) ? value : null;
}

function stringAt(value: unknown, path: string[]): string | null {
  const found = readPath(value, path);
  return typeof found === 'string' ? found : null;
}

function readPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
