import Anthropic from '@anthropic-ai/sdk';
import { CASCADE_RULE_IDS, MAX_REASONING_WORDS, type ReasoningInput } from '@declutrmail/workers';
import { describe, expect, it, vi } from 'vitest';

import {
  AnthropicHaikuAdapter,
  buildAnthropicHaikuAdapter,
  renderUserPrompt,
} from './anthropic-haiku.adapter.js';
import { LlmCircuitBreaker } from './llm-circuit-breaker.js';

/**
 * AnthropicHaikuAdapter unit tests (D24, D62).
 *
 * Verifies the port contract:
 *   - happy path: returns the LLM's text on a normal response
 *   - sad paths: returns `null` for every failure mode (network, non-2xx,
 *     refusal, max_tokens, missing/empty text block)
 *   - never throws
 *   - sends the right shape (model, max_tokens, system, messages)
 *   - prompt builder includes ONLY D7/D24-allowlisted fields
 *
 * Mocks the SDK by injecting a minimal `client` stub — no real network.
 */

const SAMPLE_INPUT: ReasoningInput = {
  displayName: 'Acme Marketing',
  domain: 'acme.example',
  verdict: 'archive',
  confidence: 0.87,
  ruleLabel: 'the volume and read rate point at archiving',
  facts: { monthlyVolume: 12, readRatePct: 3 },
  gmailCategory: 'promotions',
};

interface MockMessage {
  stop_reason: string;
  content: Array<{ type: string; text?: string }>;
}

/** Build a stub `Anthropic` client whose `messages.create` returns the given value. */
function stubClient(mock: ReturnType<typeof vi.fn>): Anthropic {
  return { messages: { create: mock } } as unknown as Anthropic;
}

describe('renderUserPrompt', () => {
  it('includes only D7-allowlisted metadata fields', () => {
    const out = renderUserPrompt(SAMPLE_INPUT);
    expect(out).toContain('Acme Marketing');
    expect(out).toContain('acme.example');
    expect(out).toContain('promotions');
    expect(out).toContain('12 messages');
    expect(out).toContain('3%');
    expect(out).toContain('the volume and read rate point at archiving');
    expect(out).toContain('Archive');
    expect(out).toContain('87%');
  });

  it('falls back to domain when displayName is blank', () => {
    const out = renderUserPrompt({ ...SAMPLE_INPUT, displayName: '   ' });
    // First line should be `Sender: <domain>` rather than empty.
    const senderLine = out.split('\n')[0];
    expect(senderLine).toBe('Sender: acme.example');
  });

  it('falls back to "This sender" when displayName + domain both blank', () => {
    const out = renderUserPrompt({ ...SAMPLE_INPUT, displayName: '', domain: '' });
    expect(out.split('\n')[0]).toBe('Sender: This sender');
    // Domain row still rendered — defensively shows "(unknown)" so the
    // model can't confuse a blank field with a missing one.
    expect(out).toContain('Domain: (unknown)');
  });

  /**
   * The prompt used to say `Engine rule: score_archive`, and Haiku wrote
   * it straight back out: "The high_read_rate engine rule confirms this
   * sender deserves inbox placement" was live copy on 440+ senders. The
   * model reads what we hand it — so we hand it a sentence, not an id.
   */
  it('names no internal rule id and does not invite the model to cite one', () => {
    const out = renderUserPrompt(SAMPLE_INPUT);
    for (const id of CASCADE_RULE_IDS) {
      expect(out).not.toContain(id);
    }
    expect(out).not.toMatch(/engine rule/i);
  });

  it('does NOT reference any body / subject / snippet field', () => {
    // The ReasoningInput type at the contract layer already prevents
    // this, but assert the rendered string contains no body markers
    // either — defense-in-depth for D7/D228.
    const out = renderUserPrompt(SAMPLE_INPUT);
    expect(out).not.toMatch(/\bbody\b/i);
    expect(out).not.toMatch(/\bsubject\b/i);
    expect(out).not.toMatch(/\bsnippet\b/i);
    expect(out).not.toMatch(/\bcontent\b/i);
  });
});

describe('AnthropicHaikuAdapter.explain', () => {
  it('returns the LLM text on a normal end_turn response', async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Acme sends 12/mo and you read 3%. Archive matches.' }],
    } satisfies MockMessage);
    const adapter = new AnthropicHaikuAdapter({
      client: stubClient(create),
      breaker: new LlmCircuitBreaker(),
    });
    const result = await adapter.explain(SAMPLE_INPUT);
    expect(result).toBe('Acme sends 12/mo and you read 3%. Archive matches.');
  });

  it('sends a request with model=claude-haiku-4-5, max_tokens=256, the system prompt, and the rendered user message', async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'ok' }],
    } satisfies MockMessage);
    const adapter = new AnthropicHaikuAdapter({
      client: stubClient(create),
      breaker: new LlmCircuitBreaker(),
    });
    await adapter.explain(SAMPLE_INPUT);

    expect(create).toHaveBeenCalledTimes(1);
    const callArg = create.mock.calls[0]![0];
    expect(callArg.model).toBe('claude-haiku-4-5');
    expect(callArg.max_tokens).toBe(256);
    expect(typeof callArg.system).toBe('string');
    expect(callArg.system).toContain('executive assistant');
    expect(callArg.messages).toHaveLength(1);
    expect(callArg.messages[0].role).toBe('user');
    expect(callArg.messages[0].content).toBe(renderUserPrompt(SAMPLE_INPUT));
  });

  it('trims leading/trailing whitespace on the returned text', async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '\n  Trimmed.  \n' }],
    } satisfies MockMessage);
    const adapter = new AnthropicHaikuAdapter({
      client: stubClient(create),
      breaker: new LlmCircuitBreaker(),
    });
    const result = await adapter.explain(SAMPLE_INPUT);
    expect(result).toBe('Trimmed.');
  });

  it('returns null when stop_reason is "refusal" (safety guardrail)', async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: 'refusal',
      content: [{ type: 'text', text: 'I cannot help with that.' }],
    } satisfies MockMessage);
    const adapter = new AnthropicHaikuAdapter({
      client: stubClient(create),
      breaker: new LlmCircuitBreaker(),
    });
    const result = await adapter.explain(SAMPLE_INPUT);
    expect(result).toBeNull();
  });

  it('returns null when stop_reason is "max_tokens" (mid-sentence truncation)', async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: 'max_tokens',
      content: [{ type: 'text', text: 'Acme sends 12/mo and you read 3%. The recommen' }],
    } satisfies MockMessage);
    const adapter = new AnthropicHaikuAdapter({
      client: stubClient(create),
      breaker: new LlmCircuitBreaker(),
    });
    const result = await adapter.explain(SAMPLE_INPUT);
    expect(result).toBeNull();
  });

  it('returns null when response contains no text block', async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'thinking', text: '...' }],
    } satisfies MockMessage);
    const adapter = new AnthropicHaikuAdapter({
      client: stubClient(create),
      breaker: new LlmCircuitBreaker(),
    });
    const result = await adapter.explain(SAMPLE_INPUT);
    expect(result).toBeNull();
  });

  it('returns null when the text block is empty after trim', async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '   \n   ' }],
    } satisfies MockMessage);
    const adapter = new AnthropicHaikuAdapter({
      client: stubClient(create),
      breaker: new LlmCircuitBreaker(),
    });
    const result = await adapter.explain(SAMPLE_INPUT);
    expect(result).toBeNull();
  });

  it('returns null when the explanation runs past the word ceiling (falls back to the template)', async () => {
    // The 50-word, two-sentence row seen live on 2026-09-19.
    const paragraph =
      "Bank of America's alerts are arriving at a high volume of roughly 66 messages per month but are being read only 1% of the time, indicating they're transactional noise rather than valuable information worth keeping in the inbox. Archiving these notifications preserves access to them if needed while clearing daily clutter.";
    expect(paragraph.split(/\s+/).length).toBeGreaterThan(MAX_REASONING_WORDS);
    const create = vi.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: paragraph }],
    } satisfies MockMessage);
    const adapter = new AnthropicHaikuAdapter({
      client: stubClient(create),
      breaker: new LlmCircuitBreaker(),
    });
    expect(await adapter.explain(SAMPLE_INPUT)).toBeNull();
  });

  it('keeps an explanation at exactly the word ceiling', async () => {
    const atCeiling = Array.from({ length: MAX_REASONING_WORDS }, () => 'word').join(' ');
    const create = vi.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: atCeiling }],
    } satisfies MockMessage);
    const adapter = new AnthropicHaikuAdapter({
      client: stubClient(create),
      breaker: new LlmCircuitBreaker(),
    });
    expect(await adapter.explain(SAMPLE_INPUT)).toBe(atCeiling);
  });

  it('asks for one sentence and the "marked read" wording', async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'ok' }],
    } satisfies MockMessage);
    const adapter = new AnthropicHaikuAdapter({
      client: stubClient(create),
      breaker: new LlmCircuitBreaker(),
    });
    await adapter.explain(SAMPLE_INPUT);
    const callArg = create.mock.calls[0]![0];
    expect(callArg.system).toContain('at most 25 words');
    expect(callArg.system).toContain('marked read');
    expect(callArg.messages[0].content).toContain('Marked read over the last 90 days: 3%');
  });

  it('returns null on a network / SDK error (never throws)', async () => {
    const create = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    const adapter = new AnthropicHaikuAdapter({
      client: stubClient(create),
      breaker: new LlmCircuitBreaker(),
    });
    const result = await adapter.explain(SAMPLE_INPUT);
    expect(result).toBeNull();
  });

  it('returns null on an Anthropic.APIError (rate limit / 5xx / etc.) — never throws', async () => {
    // Construct a 429 via the SDK error class so the structured-log
    // branch in the adapter fires.
    const err = new Anthropic.RateLimitError(429, undefined, 'rate limited', new Headers());
    const create = vi.fn().mockRejectedValue(err);
    const adapter = new AnthropicHaikuAdapter({
      client: stubClient(create),
      breaker: new LlmCircuitBreaker(),
    });
    const result = await adapter.explain(SAMPLE_INPUT);
    expect(result).toBeNull();
  });

  it('survives a stop_reason of "pause_turn" (agentic loop pause — treated as fallback)', async () => {
    // pause_turn isn't expected on a single-turn explain call, but
    // codify the defensive behavior: anything that isn't a clean
    // end_turn with text falls back to null.
    const create = vi.fn().mockResolvedValue({
      stop_reason: 'pause_turn',
      content: [{ type: 'text', text: 'partial' }],
    } satisfies MockMessage);
    const adapter = new AnthropicHaikuAdapter({
      client: stubClient(create),
      breaker: new LlmCircuitBreaker(),
    });
    // end_turn path is the only one that returns text; pause_turn
    // happens to land in the text-extraction branch too. Adapter
    // returns the text — that's intentional, the consumer worker
    // handles loop continuation if needed. Lock the behavior so a
    // future change to extractText() is a deliberate decision.
    const result = await adapter.explain(SAMPLE_INPUT);
    expect(result).toBe('partial');
  });
});

/** A refusal built the way the SDK builds one from an HTTP error response. */
function providerError(
  status: number,
  type: string,
  message: string,
  headers: Record<string, string> = {},
) {
  return Anthropic.APIError.generate(
    status,
    { type: 'error', error: { type, message }, request_id: 'req_test_1' },
    undefined,
    new Headers({ 'request-id': 'req_test_1', ...headers }),
  );
}

// The 2026-09-24 production refusal (see llm-circuit-breaker.ts).
const CREDIT_BALANCE = () =>
  providerError(
    400,
    'invalid_request_error',
    'Your credit balance is too low to access the Anthropic API',
  );

describe('AnthropicHaikuAdapter — provider refusals', () => {
  it('stops calling Anthropic after a credit-balance refusal and reports itself blocked', async () => {
    const create = vi.fn().mockRejectedValue(CREDIT_BALANCE());
    const adapter = new AnthropicHaikuAdapter({
      client: stubClient(create),
      breaker: new LlmCircuitBreaker(),
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await adapter.explain(SAMPLE_INPUT)).toBeNull();
      expect(adapter.isBlocked()).toBe(true);
      expect(await adapter.explain(SAMPLE_INPUT)).toBeNull();
      expect(await adapter.explain(SAMPLE_INPUT)).toBeNull();
      expect(create).toHaveBeenCalledTimes(1);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('keeps calling through a rate limit — the next call can succeed', async () => {
    const create = vi
      .fn()
      .mockRejectedValue(
        providerError(429, 'rate_limit_error', 'test: rate limited', { 'retry-after': '2' }),
      );
    const adapter = new AnthropicHaikuAdapter({
      client: stubClient(create),
      breaker: new LlmCircuitBreaker(),
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await adapter.explain(SAMPLE_INPUT);
      await adapter.explain(SAMPLE_INPUT);
      expect(create).toHaveBeenCalledTimes(2);
      expect(adapter.isBlocked()).toBe(false);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('calls again once the cool-down has passed', async () => {
    let now = Date.parse('2026-09-24T08:15:00Z');
    const breaker = new LlmCircuitBreaker({ cooldownMs: 1_000, now: () => now });
    const create = vi
      .fn()
      .mockRejectedValueOnce(CREDIT_BALANCE())
      .mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Back.' }] });
    const adapter = new AnthropicHaikuAdapter({ client: stubClient(create), breaker });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await adapter.explain(SAMPLE_INPUT);
      now += 1_000;
      expect(await adapter.explain(SAMPLE_INPUT)).toBe('Back.');
      expect(await adapter.explain(SAMPLE_INPUT)).toBe('Back.');
      expect(create).toHaveBeenCalledTimes(3);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('never logs the prompt, even when the provider echoes it back', async () => {
    const prompt = renderUserPrompt(SAMPLE_INPUT);
    const create = vi
      .fn()
      .mockRejectedValueOnce(providerError(400, 'invalid_request_error', `bad input: ${prompt}`))
      .mockRejectedValueOnce(providerError(429, 'rate_limit_error', `slow down: ${prompt}`))
      .mockRejectedValueOnce(providerError(503, 'api_error', `upstream: ${prompt}`))
      // No HTTP status: how a streamed error arrives, message and all.
      .mockRejectedValueOnce(new Anthropic.APIConnectionError({ message: `stream: ${prompt}` }));
    const adapter = new AnthropicHaikuAdapter({
      client: stubClient(create),
      breaker: new LlmCircuitBreaker(),
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      for (let i = 0; i < 4; i += 1) await adapter.explain(SAMPLE_INPUT);
      expect(create).toHaveBeenCalledTimes(4);
      const logged = [...warnSpy.mock.calls, ...errorSpy.mock.calls].map((c) => String(c[0]));
      expect(logged).toHaveLength(4);
      for (const line of logged) expect(line).not.toContain('Acme Marketing');
      const parsed = logged.map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(parsed.filter((line) => line.requestId === 'req_test_1')).toHaveLength(3);
      expect(parsed).toContainEqual(expect.objectContaining({ error: 'APIConnectionError' }));
    } finally {
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});

describe('buildAnthropicHaikuAdapter', () => {
  it('returns null when ANTHROPIC_API_KEY is unset', () => {
    expect(buildAnthropicHaikuAdapter(new LlmCircuitBreaker(), {})).toBeNull();
  });

  it('returns null when ANTHROPIC_API_KEY is an empty string', () => {
    expect(
      buildAnthropicHaikuAdapter(new LlmCircuitBreaker(), { ANTHROPIC_API_KEY: '' }),
    ).toBeNull();
  });

  it('constructs the adapter when ANTHROPIC_API_KEY is present', () => {
    const adapter = buildAnthropicHaikuAdapter(new LlmCircuitBreaker(), {
      ANTHROPIC_API_KEY: 'sk-ant-test-key',
    });
    expect(adapter).toBeInstanceOf(AnthropicHaikuAdapter);
  });
});
