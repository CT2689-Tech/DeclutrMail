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
// type, structured error code and request id — never the provider's
// message, which could echo the request, and never the prompt.

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
 *   - `other`: any other refusal of the request itself (4xx).
 */
export type ProviderRejectionReason =
  | 'credit_balance'
  | 'spend_limit'
  | 'tier_spend_cap'
  | 'billing_error'
  | 'auth'
  | 'not_found'
  | 'other';

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
    if (rejection.reason !== 'other') this.pausedUntil = this.now() + this.cooldownMs;
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
        pausedMs: rejection.reason === 'other' ? 0 : this.cooldownMs,
      }),
    );
    return rejection;
  }
}

/**
 * What an adapter logs for a transient provider failure: status, type
 * and request id when the provider answered, the SDK's own message when
 * it did not (network, timeout). Never a response body — the provider's
 * message can echo the request, and the Brief's request holds subjects
 * and snippets.
 */
export function providerErrorFields(err: unknown): Record<string, unknown> {
  const status = readPath(err, ['status']);
  if (typeof status === 'number') {
    return { status, type: errorType(err), requestId: requestIdOf(err) };
  }
  return { error: err instanceof Error ? err.message : String(err) };
}

/**
 * Structured fields first — status, `error.type`, `error.details.
 * error_code`. The provider's wording is read only where Anthropic sends
 * two different refusals under one status and type: a 400
 * `invalid_request_error` is a malformed request, an exhausted credit
 * balance, or a spend limit we set, told apart only by the message.
 */
function classifyProviderRejection(err: unknown): ProviderRejection | null {
  const status = readPath(err, ['status']);
  if (typeof status !== 'number') return null;
  const type = errorType(err);
  const errorCode = stringAt(err, ['error', 'error', 'details', 'error_code']);
  const base = { status, type, errorCode, requestId: requestIdOf(err) };

  // A 429 is a rate limit (transient, the SDK retries it) unless it is
  // the tier's monthly spend cap, which fails every retry until the
  // month turns. Anthropic marks that one with a structured code.
  if (status === 429) {
    return errorCode === 'enforced_spend_limit_reached'
      ? { ...base, reason: 'tier_spend_cap' }
      : null;
  }
  // 5xx: the provider is down, not refusing. 408/409: the SDK retries.
  if (status < 400 || status >= 500 || status === 408 || status === 409) return null;

  if (status === 402 || type === 'billing_error') return { ...base, reason: 'billing_error' };
  const message = providerMessage(err);
  if (/credit balance/i.test(message)) return { ...base, reason: 'credit_balance' };
  if (/API usage limits/i.test(message)) return { ...base, reason: 'spend_limit' };
  if (status === 401 || status === 403) return { ...base, reason: 'auth' };
  if (status === 404) return { ...base, reason: 'not_found' };
  return { ...base, reason: 'other' };
}

function errorType(err: unknown): string | null {
  const direct = readPath(err, ['type']);
  return typeof direct === 'string' ? direct : stringAt(err, ['error', 'error', 'type']);
}

function requestIdOf(err: unknown): string | null {
  const header = readPath(err, ['requestID']);
  return typeof header === 'string' ? header : stringAt(err, ['error', 'request_id']);
}

/**
 * The provider's message from the response body, falling back to the
 * SDK's composed `Error.message` (which embeds the body) so a change in
 * where the SDK keeps the body cannot hide a billing refusal.
 */
function providerMessage(err: unknown): string {
  const fromBody = stringAt(err, ['error', 'error', 'message']);
  if (fromBody !== null) return fromBody;
  return err instanceof Error ? err.message : '';
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
