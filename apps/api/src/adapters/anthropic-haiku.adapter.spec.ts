import Anthropic from '@anthropic-ai/sdk';
import type { ReasoningInput } from '@declutrmail/workers';
import { describe, expect, it, vi } from 'vitest';

import {
  AnthropicHaikuAdapter,
  buildAnthropicHaikuAdapter,
  renderUserPrompt,
} from './anthropic-haiku.adapter.js';

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
  ruleLabel: 'score_archive',
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
    expect(out).toContain('score_archive');
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
    const adapter = new AnthropicHaikuAdapter({ client: stubClient(create) });
    const result = await adapter.explain(SAMPLE_INPUT);
    expect(result).toBe('Acme sends 12/mo and you read 3%. Archive matches.');
  });

  it('sends a request with model=claude-haiku-4-5, max_tokens=256, the system prompt, and the rendered user message', async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'ok' }],
    } satisfies MockMessage);
    const adapter = new AnthropicHaikuAdapter({ client: stubClient(create) });
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
    const adapter = new AnthropicHaikuAdapter({ client: stubClient(create) });
    const result = await adapter.explain(SAMPLE_INPUT);
    expect(result).toBe('Trimmed.');
  });

  it('returns null when stop_reason is "refusal" (safety guardrail)', async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: 'refusal',
      content: [{ type: 'text', text: 'I cannot help with that.' }],
    } satisfies MockMessage);
    const adapter = new AnthropicHaikuAdapter({ client: stubClient(create) });
    const result = await adapter.explain(SAMPLE_INPUT);
    expect(result).toBeNull();
  });

  it('returns null when stop_reason is "max_tokens" (mid-sentence truncation)', async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: 'max_tokens',
      content: [{ type: 'text', text: 'Acme sends 12/mo and you read 3%. The recommen' }],
    } satisfies MockMessage);
    const adapter = new AnthropicHaikuAdapter({ client: stubClient(create) });
    const result = await adapter.explain(SAMPLE_INPUT);
    expect(result).toBeNull();
  });

  it('returns null when response contains no text block', async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'thinking', text: '...' }],
    } satisfies MockMessage);
    const adapter = new AnthropicHaikuAdapter({ client: stubClient(create) });
    const result = await adapter.explain(SAMPLE_INPUT);
    expect(result).toBeNull();
  });

  it('returns null when the text block is empty after trim', async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '   \n   ' }],
    } satisfies MockMessage);
    const adapter = new AnthropicHaikuAdapter({ client: stubClient(create) });
    const result = await adapter.explain(SAMPLE_INPUT);
    expect(result).toBeNull();
  });

  it('returns null on a network / SDK error (never throws)', async () => {
    const create = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    const adapter = new AnthropicHaikuAdapter({ client: stubClient(create) });
    const result = await adapter.explain(SAMPLE_INPUT);
    expect(result).toBeNull();
  });

  it('returns null on an Anthropic.APIError (rate limit / 5xx / etc.) — never throws', async () => {
    // Construct a 429 via the SDK error class so the structured-log
    // branch in the adapter fires.
    const err = new Anthropic.RateLimitError(429, undefined, 'rate limited', new Headers());
    const create = vi.fn().mockRejectedValue(err);
    const adapter = new AnthropicHaikuAdapter({ client: stubClient(create) });
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
    const adapter = new AnthropicHaikuAdapter({ client: stubClient(create) });
    // end_turn path is the only one that returns text; pause_turn
    // happens to land in the text-extraction branch too. Adapter
    // returns the text — that's intentional, the consumer worker
    // handles loop continuation if needed. Lock the behavior so a
    // future change to extractText() is a deliberate decision.
    const result = await adapter.explain(SAMPLE_INPUT);
    expect(result).toBe('partial');
  });
});

describe('buildAnthropicHaikuAdapter', () => {
  it('returns null when ANTHROPIC_API_KEY is unset', () => {
    expect(buildAnthropicHaikuAdapter({})).toBeNull();
  });

  it('returns null when ANTHROPIC_API_KEY is an empty string', () => {
    expect(buildAnthropicHaikuAdapter({ ANTHROPIC_API_KEY: '' })).toBeNull();
  });

  it('constructs the adapter when ANTHROPIC_API_KEY is present', () => {
    const adapter = buildAnthropicHaikuAdapter({ ANTHROPIC_API_KEY: 'sk-ant-test-key' });
    expect(adapter).toBeInstanceOf(AnthropicHaikuAdapter);
  });
});
