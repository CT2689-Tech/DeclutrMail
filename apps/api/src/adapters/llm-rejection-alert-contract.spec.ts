import Anthropic from '@anthropic-ai/sdk';
import type { BriefNarrativeInput, ReasoningInput } from '@declutrmail/workers';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { AnthropicHaikuAdapter } from './anthropic-haiku.adapter.js';
import { BriefLlmAnthropicAdapter } from './brief-llm-anthropic.adapter.js';
import { LlmCircuitBreaker, PROVIDER_REJECTION_REASONS } from './llm-circuit-breaker.js';

/**
 * The join between the line the adapters log and the filter the page
 * counts (`scripts/setup-llm-rejection-alert.mjs`).
 *
 * Each side has its own tests, and both could stay green while the join
 * breaks: rename the log `kind`, or edit the filter, and the metric counts
 * nothing forever — a page wired to nothing. So this runs the real
 * adapters, captures what they actually print, and evaluates the
 * script's exact filter string against it, the way Cloud Logging would
 * see it once Cloud Run parses the JSON line into `jsonPayload`.
 */

interface AlertModule {
  LOG_FILTER: string;
  expectedMetric: () => {
    labelExtractors: Record<string, string>;
    metricDescriptor: { labels: Array<{ key: string; description: string }> };
  };
  expectedPolicy: (channel: string) => { documentation: { content: string } };
}

const WORKER_RESOURCE = {
  type: 'cloud_run_revision',
  labels: { service_name: 'declutrmail-worker' },
};

/**
 * Evaluates the subset of the Logging query language the filter uses:
 * `path="value"` clauses joined by AND. Anything else throws — if the
 * filter grows syntax this cannot read, the test must fail, not match.
 */
function matches(filter: string, entry: Record<string, unknown>): boolean {
  return filter.split(' AND ').every((clause) => {
    const parsed = /^([A-Za-z_.]+)="([^"]*)"$/.exec(clause.trim());
    if (!parsed) throw new Error(`filter clause this test cannot evaluate: ${clause}`);
    const [, path, want] = parsed;
    const got = path!
      .split('.')
      .reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], entry);
    return got === want;
  });
}

const REASONING_INPUT: ReasoningInput = {
  displayName: 'Acme Marketing',
  domain: 'acme.example',
  verdict: 'archive',
  confidence: 0.87,
  ruleLabel: 'rarely marked read',
  facts: { monthlyVolume: 12, readRatePct: 3 },
  gmailCategory: 'promotions',
};
const BRIEF_INPUT: BriefNarrativeInput = { reply: [], fyi: [], noise: [] };

function providerError(status: number, type: string, message: string, headers = {}) {
  return Anthropic.APIError.generate(
    status,
    { type: 'error', error: { type, message }, request_id: 'req_contract' },
    undefined,
    new Headers({ 'request-id': 'req_contract', ...headers }),
  );
}
const creditBalance = () =>
  providerError(
    400,
    'invalid_request_error',
    'Your credit balance is too low to access the Anthropic API',
  );
const client = (err: unknown) =>
  ({ messages: { create: vi.fn().mockRejectedValue(err) } }) as unknown as Anthropic;

let alert: AlertModule;
let errorSpy: MockInstance<typeof console.error>;
let warnSpy: MockInstance<typeof console.warn>;
beforeEach(async () => {
  const script = new URL('../../../../scripts/setup-llm-rejection-alert.mjs', import.meta.url);
  alert = (await import(script.href)) as AlertModule;
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
  warnSpy.mockRestore();
});

function printed(): Array<Record<string, unknown>> {
  return [...errorSpy.mock.calls, ...warnSpy.mock.calls].map(
    (call) => JSON.parse(String(call[0])) as Record<string, unknown>,
  );
}

describe('llm_provider_rejected — the metric counts what the adapters print', () => {
  it('counts a credit-balance refusal from the reasoning adapter', async () => {
    await new AnthropicHaikuAdapter({
      client: client(creditBalance()),
      breaker: new LlmCircuitBreaker(),
    }).explain(REASONING_INPUT);
    const [line] = printed();
    expect(matches(alert.LOG_FILTER, { resource: WORKER_RESOURCE, jsonPayload: line })).toBe(true);
    // The metric's `reason` label reads this field.
    expect(alert.expectedMetric().labelExtractors.reason).toBe('EXTRACT(jsonPayload.reason)');
    expect(line?.reason).toBe('credit_balance');
  });

  it('counts a refusal from the Brief adapter, and one from the API service', async () => {
    await new BriefLlmAnthropicAdapter({
      client: client(providerError(401, 'authentication_error', 'test: invalid x-api-key')),
      breaker: new LlmCircuitBreaker(),
    }).generateNarrative(BRIEF_INPUT);
    const [line] = printed();
    expect(matches(alert.LOG_FILTER, { resource: WORKER_RESOURCE, jsonPayload: line })).toBe(true);
    // Not pinned to the worker: a future API-side caller must still page.
    const api = { type: 'cloud_run_revision', labels: { service_name: 'declutrmail-api' } };
    expect(matches(alert.LOG_FILTER, { resource: api, jsonPayload: line })).toBe(true);
  });

  it('does not count a transient failure — a rate limit is not a page', async () => {
    await new AnthropicHaikuAdapter({
      client: client(
        providerError(429, 'rate_limit_error', 'test: slow down', { 'retry-after': '2' }),
      ),
      breaker: new LlmCircuitBreaker(),
    }).explain(REASONING_INPUT);
    const [line] = printed();
    expect(line?.kind).toBe('reasoning.adapter_error');
    expect(matches(alert.LOG_FILTER, { resource: WORKER_RESOURCE, jsonPayload: line })).toBe(false);
  });
});

describe('llm_provider_rejected — the page explains every reason the breaker can log', () => {
  it('names each reason in the metric label and in the runbook the email carries', () => {
    // Both lists are hand-kept prose in the script; a reason added here
    // and not there would reach the founder's inbox unexplained.
    const label = alert.expectedMetric().metricDescriptor.labels.find((l) => l.key === 'reason');
    const runbook = alert.expectedPolicy('projects/p/notificationChannels/1').documentation.content;
    for (const reason of PROVIDER_REJECTION_REASONS) {
      expect(label?.description).toContain(reason);
      expect(runbook).toContain(`\`${reason}\``);
    }
  });
});
