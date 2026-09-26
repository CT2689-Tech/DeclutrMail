import Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { LLM_PROVIDER_REJECTED_KIND, LlmCircuitBreaker } from './llm-circuit-breaker.js';

/**
 * LlmCircuitBreaker — what stops the worker making calls the provider has
 * already refused.
 *
 * On 2026-09-24 the Anthropic balance hit zero and one mailbox's score
 * sweep made 2,927 calls in 431 s, every one refused with the same 400,
 * each paced through the rate limiter as if it might succeed. Nothing
 * paged. These tests pin which refusals mean "stop", that the stop lasts
 * the cool-down, and that it lifts on its own afterwards.
 *
 * Errors are built with `Anthropic.APIError.generate` — the factory the
 * SDK itself runs on an HTTP error response — so `status`, `type`,
 * `requestID` and the body sit exactly where a real refusal puts them.
 */

const SOURCE = { adapter: 'TestAdapter', model: 'claude-haiku-4-5' };
const COOLDOWN_MS = 60_000;

function providerError(
  status: number,
  type: string,
  message: string,
  opts: { errorCode?: string; headers?: Record<string, string> } = {},
) {
  return Anthropic.APIError.generate(
    status,
    {
      type: 'error',
      error: {
        type,
        message,
        ...(opts.errorCode ? { details: { error_code: opts.errorCode } } : {}),
      },
      request_id: 'req_test_1',
    },
    undefined,
    new Headers({ 'request-id': 'req_test_1', ...opts.headers }),
  );
}

// Provider wording. The credit-balance text is the 2026-09-24 production
// log line; the spend-limit prefixes and the spend-cap body are quoted
// from platform.claude.com/docs/en/api/rate-limits (read 2026-09-26).
// Messages starting "test:" are placeholders where only status/type matter.
const CREDIT_BALANCE = providerError(
  400,
  'invalid_request_error',
  'Your credit balance is too low to access the Anthropic API',
);
const SPEND_LIMIT = providerError(
  400,
  'invalid_request_error',
  'You have reached your specified API usage limits',
);
const WORKSPACE_SPEND_LIMIT = providerError(
  400,
  'invalid_request_error',
  'You have reached your specified workspace API usage limits',
);
const TIER_SPEND_CAP = providerError(
  429,
  'rate_limit_error',
  "You have reached your API usage limits: your organization has crossed its monthly API usage threshold, set based on your organization's API tier. You will regain access on 2026-09-01 at 00:00 UTC.",
  { errorCode: 'enforced_spend_limit_reached' },
);
const BILLING_ERROR = providerError(402, 'billing_error', 'test: payment problem');
const UNAUTHENTICATED = providerError(401, 'authentication_error', 'test: invalid x-api-key');
const FORBIDDEN = providerError(403, 'permission_error', 'test: key lacks permission');
const MODEL_NOT_FOUND = providerError(404, 'not_found_error', 'model: claude-haiku-4-5');
const MALFORMED_REQUEST = providerError(
  400,
  'invalid_request_error',
  'messages: roles must alternate between "user" and "assistant"',
);
const TOO_LARGE = providerError(413, 'request_too_large', 'test: request too large');
const RATE_LIMITED = providerError(429, 'rate_limit_error', 'test: rate limited', {
  headers: { 'retry-after': '3' },
});
const SERVER_ERROR = providerError(500, 'api_error', 'test: internal error');
const OVERLOADED = providerError(529, 'overloaded_error', 'test: overloaded');

let errorSpy: MockInstance<typeof console.error>;
beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
});

function makeBreaker(): { breaker: LlmCircuitBreaker; advance: (ms: number) => void } {
  let now = Date.parse('2026-09-24T08:15:00Z');
  const breaker = new LlmCircuitBreaker({ cooldownMs: COOLDOWN_MS, now: () => now });
  return {
    breaker,
    advance: (ms) => {
      now += ms;
    },
  };
}

function loggedLines(): Array<Record<string, unknown>> {
  return errorSpy.mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>);
}

describe('LlmCircuitBreaker — which failures stop calls', () => {
  // `pauses` is the product decision: a refusal about the account or the
  // model repeats on every call until a person acts, so calls stop. A
  // refusal of one request's shape might be that request alone, so it
  // is reported (and paged on) without stopping the others.
  it.each([
    ['credit balance too low (400)', CREDIT_BALANCE, 'credit_balance', true],
    ['org spend limit reached (400)', SPEND_LIMIT, 'spend_limit', true],
    ['workspace spend limit reached (400)', WORKSPACE_SPEND_LIMIT, 'spend_limit', true],
    ['tier monthly spend cap (429, no retry-after)', TIER_SPEND_CAP, 'tier_spend_cap', true],
    ['billing_error (402)', BILLING_ERROR, 'billing_error', true],
    ['authentication_error (401)', UNAUTHENTICATED, 'auth', true],
    ['permission_error (403)', FORBIDDEN, 'auth', true],
    ['model not found (404)', MODEL_NOT_FOUND, 'not_found', true],
    ['malformed request (400)', MALFORMED_REQUEST, 'other', false],
    ['request too large (413)', TOO_LARGE, 'other', false],
  ])('%s → reason %s, pauses calls: %s', (_label, err, reason, pauses) => {
    const { breaker } = makeBreaker();
    const rejection = breaker.recordFailure(err, SOURCE);
    expect(rejection?.reason).toBe(reason);
    expect(breaker.isBlocked()).toBe(pauses);
  });

  it.each([
    ['rate limited (429 with retry-after)', RATE_LIMITED],
    ['server error (500)', SERVER_ERROR],
    ['overloaded (529)', OVERLOADED],
    ['connection error', new Anthropic.APIConnectionError({ message: 'Connection error.' })],
    ['client timeout', new Anthropic.APIConnectionTimeoutError()],
    ['a non-SDK error', new Error('boom')],
    ['a thrown non-error', 'boom'],
  ])('%s is transient: not a rejection, nothing logged, calls continue', (_label, err) => {
    const { breaker } = makeBreaker();
    expect(breaker.recordFailure(err, SOURCE)).toBeNull();
    expect(breaker.isBlocked()).toBe(false);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe('LlmCircuitBreaker — pause and recovery', () => {
  it('blocks for the whole cool-down after a pausing rejection, then lets calls try again', () => {
    const { breaker, advance } = makeBreaker();
    breaker.recordFailure(CREDIT_BALANCE, SOURCE);
    expect(breaker.isBlocked()).toBe(true);
    advance(COOLDOWN_MS - 1);
    expect(breaker.isBlocked()).toBe(true);
    advance(1);
    expect(breaker.isBlocked()).toBe(false);
  });

  it('a refusal after the cool-down pauses for a fresh cool-down from that refusal', () => {
    const { breaker, advance } = makeBreaker();
    breaker.recordFailure(CREDIT_BALANCE, SOURCE);
    advance(COOLDOWN_MS + 5_000);
    breaker.recordFailure(CREDIT_BALANCE, SOURCE);

    advance(COOLDOWN_MS - 1);
    expect(breaker.isBlocked()).toBe(true);
    advance(1);
    expect(breaker.isBlocked()).toBe(false);
  });

  it('a transient failure neither starts a pause nor stretches one', () => {
    const { breaker, advance } = makeBreaker();
    breaker.recordFailure(UNAUTHENTICATED, SOURCE);
    advance(COOLDOWN_MS - 1);
    breaker.recordFailure(new Anthropic.APIConnectionTimeoutError(), SOURCE);
    breaker.recordFailure(RATE_LIMITED, SOURCE);
    advance(1);
    expect(breaker.isBlocked()).toBe(false);
  });
});

describe('LlmCircuitBreaker — the log line the alert counts', () => {
  it('logs one provider-rejected line per rejection naming reason, status, type and the pause', () => {
    const { breaker } = makeBreaker();
    breaker.recordFailure(TIER_SPEND_CAP, SOURCE);
    breaker.recordFailure(MALFORMED_REQUEST, SOURCE);

    const lines = loggedLines();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      level: 'error',
      kind: LLM_PROVIDER_REJECTED_KIND,
      adapter: 'TestAdapter',
      model: 'claude-haiku-4-5',
      reason: 'tier_spend_cap',
      status: 429,
      type: 'rate_limit_error',
      errorCode: 'enforced_spend_limit_reached',
      requestId: 'req_test_1',
      pausedMs: COOLDOWN_MS,
    });
    expect(lines[1]).toMatchObject({
      kind: LLM_PROVIDER_REJECTED_KIND,
      reason: 'other',
      status: 400,
      pausedMs: 0,
    });
  });

  it('never logs the provider message, which could echo the request', () => {
    const { breaker } = makeBreaker();
    breaker.recordFailure(
      providerError(400, 'invalid_request_error', 'messages.0.content: "Sender: Acme Marketing"'),
      SOURCE,
    );
    breaker.recordFailure(CREDIT_BALANCE, SOURCE);
    const raw = errorSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(raw).not.toContain('Acme Marketing');
    expect(raw).not.toContain('credit balance');
  });
});
