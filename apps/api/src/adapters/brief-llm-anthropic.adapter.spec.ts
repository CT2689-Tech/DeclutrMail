import Anthropic from '@anthropic-ai/sdk';
import type { BriefNarrativeInput } from '@declutrmail/workers';
import { describe, expect, it, vi } from 'vitest';

import {
  BriefLlmAnthropicAdapter,
  buildBriefLlmAdapter,
  renderBriefUserPrompt,
} from './brief-llm-anthropic.adapter.js';

/**
 * BriefLlmAnthropicAdapter unit tests (D62).
 *
 * Verifies the port contract:
 *   - happy path: returns the LLM's text on a normal response
 *   - sad paths: returns `null` for every failure mode (network, non-2xx,
 *     refusal, max_tokens, missing/empty text block)
 *   - never throws
 *   - sends the right shape (model, max_tokens, system, messages)
 *   - prompt builder includes ONLY D7/D62-allowlisted fields
 *
 * Mocks the SDK by injecting a minimal `client` stub — no real network.
 */

const SAMPLE_INPUT: BriefNarrativeInput = {
  reply: [
    {
      senderName: 'Boss',
      senderEmail: 'boss@example.com',
      subject: 'Q4 plans',
      snippet: 'Can we move the Q4 sync to Thursday?',
      isVip: true,
    },
  ],
  fyi: [
    {
      senderName: 'Bank',
      senderEmail: 'no-reply@bank.example',
      subject: 'Statement available',
      snippet: 'Your April statement is ready to view.',
      isVip: false,
    },
  ],
  noise: [
    { senderName: 'Promo Co', messageCount: 3 },
    { senderName: 'News Daily', messageCount: 2 },
  ],
};

interface MockMessage {
  stop_reason: string;
  content: Array<{ type: string; text?: string }>;
}

function stubClient(mock: ReturnType<typeof vi.fn>): Anthropic {
  return { messages: { create: mock } } as unknown as Anthropic;
}

describe('renderBriefUserPrompt', () => {
  it('includes section headers + items + snippets', () => {
    const out = renderBriefUserPrompt(SAMPLE_INPUT);
    expect(out).toContain('Reply section (1 item)');
    expect(out).toContain('FYI section (1 item)');
    expect(out).toContain('Noise section (2 senders, 5 messages)');
    expect(out).toContain('Boss');
    expect(out).toContain('Q4 plans');
    expect(out).toContain('Can we move the Q4 sync to Thursday?');
    expect(out).toContain('Bank');
    expect(out).toContain('Statement available');
    expect(out).toContain('Promo Co (3 messages)');
    expect(out).toContain('News Daily (2 messages)');
  });

  it('marks VIP items with a [VIP] prefix', () => {
    const out = renderBriefUserPrompt(SAMPLE_INPUT);
    expect(out).toMatch(/\[VIP\] Boss/);
    expect(out).not.toMatch(/\[VIP\] Bank/);
  });

  it('renders "(none)" for empty sections', () => {
    const out = renderBriefUserPrompt({ reply: [], fyi: [], noise: [] });
    expect(out).toContain('Reply section (0 items):\n  (none)');
    expect(out).toContain('FYI section (0 items):\n  (none)');
    expect(out).toContain('Noise section (0 senders, 0 messages):\n  (none)');
  });

  it('truncates long noise lists with an "…and N more" suffix', () => {
    const noise = Array.from({ length: 15 }, (_, i) => ({
      senderName: `Sender-${i}`,
      messageCount: 1,
    }));
    const out = renderBriefUserPrompt({ reply: [], fyi: [], noise });
    expect(out).toContain('Sender-0');
    expect(out).toContain('Sender-9');
    expect(out).not.toContain('Sender-10');
    expect(out).toMatch(/…and 5 more senders\./);
  });

  it('truncates long snippets to keep prompt size bounded', () => {
    const longSnippet = 'word '.repeat(80).trim();
    const out = renderBriefUserPrompt({
      ...SAMPLE_INPUT,
      reply: [
        {
          senderName: 'Sender',
          senderEmail: 's@example.com',
          subject: 'subj',
          snippet: longSnippet,
          isVip: false,
        },
      ],
    });
    expect(out).toContain('…');
    // The full snippet (>160 chars) must not appear verbatim.
    expect(out).not.toContain(longSnippet);
  });

  it('falls back to email when senderName is blank', () => {
    const out = renderBriefUserPrompt({
      reply: [
        {
          senderName: '   ',
          senderEmail: 'boss@example.com',
          subject: 's',
          snippet: '',
          isVip: false,
        },
      ],
      fyi: [],
      noise: [],
    });
    expect(out).toContain('boss@example.com: s');
  });

  it('renders (no subject) when the subject is blank', () => {
    const out = renderBriefUserPrompt({
      reply: [
        {
          senderName: 'Sender',
          senderEmail: 's@example.com',
          subject: '',
          snippet: '',
          isVip: false,
        },
      ],
      fyi: [],
      noise: [],
    });
    expect(out).toContain('(no subject)');
  });

  it('does NOT reference any body / attachment / non-allowlisted header', () => {
    // The BriefNarrativeInput type at the contract layer already
    // prevents this, but assert the rendered string contains no body
    // markers either — defense-in-depth for D7/D228.
    const out = renderBriefUserPrompt(SAMPLE_INPUT);
    expect(out).not.toMatch(/\bbody\b/i);
    expect(out).not.toMatch(/\battachment\b/i);
    expect(out).not.toMatch(/\bmime\b/i);
  });
});

describe('BriefLlmAnthropicAdapter.generateNarrative', () => {
  it('returns the LLM text on a normal end_turn response', async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Boss needs a reply about Q4. Nothing else urgent.' }],
    } satisfies MockMessage);
    const adapter = new BriefLlmAnthropicAdapter({ client: stubClient(create) });
    const result = await adapter.generateNarrative(SAMPLE_INPUT);
    expect(result).toBe('Boss needs a reply about Q4. Nothing else urgent.');
  });

  it('sends a request with model=claude-haiku-4-5, max_tokens=384, the system prompt, and the rendered user message', async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'ok' }],
    } satisfies MockMessage);
    const adapter = new BriefLlmAnthropicAdapter({ client: stubClient(create) });
    await adapter.generateNarrative(SAMPLE_INPUT);

    expect(create).toHaveBeenCalledTimes(1);
    const callArg = create.mock.calls[0]![0];
    expect(callArg.model).toBe('claude-haiku-4-5');
    expect(callArg.max_tokens).toBe(384);
    expect(typeof callArg.system).toBe('string');
    expect(callArg.system).toContain('executive assistant');
    expect(callArg.messages).toHaveLength(1);
    expect(callArg.messages[0].role).toBe('user');
    expect(callArg.messages[0].content).toBe(renderBriefUserPrompt(SAMPLE_INPUT));
  });

  it('trims leading/trailing whitespace on the returned text', async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '\n  Trimmed.  \n' }],
    } satisfies MockMessage);
    const adapter = new BriefLlmAnthropicAdapter({ client: stubClient(create) });
    const result = await adapter.generateNarrative(SAMPLE_INPUT);
    expect(result).toBe('Trimmed.');
  });

  it('returns null when stop_reason is "refusal"', async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: 'refusal',
      content: [{ type: 'text', text: 'I cannot help with that.' }],
    } satisfies MockMessage);
    const adapter = new BriefLlmAnthropicAdapter({ client: stubClient(create) });
    expect(await adapter.generateNarrative(SAMPLE_INPUT)).toBeNull();
  });

  it('returns null when stop_reason is "max_tokens"', async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: 'max_tokens',
      content: [{ type: 'text', text: 'partial...' }],
    } satisfies MockMessage);
    const adapter = new BriefLlmAnthropicAdapter({ client: stubClient(create) });
    expect(await adapter.generateNarrative(SAMPLE_INPUT)).toBeNull();
  });

  it('returns null when response contains no text block', async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'thinking', text: '...' }],
    } satisfies MockMessage);
    const adapter = new BriefLlmAnthropicAdapter({ client: stubClient(create) });
    expect(await adapter.generateNarrative(SAMPLE_INPUT)).toBeNull();
  });

  it('returns null when the text block is empty after trim', async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '   \n   ' }],
    } satisfies MockMessage);
    const adapter = new BriefLlmAnthropicAdapter({ client: stubClient(create) });
    expect(await adapter.generateNarrative(SAMPLE_INPUT)).toBeNull();
  });

  it('returns null on a network / SDK error (never throws)', async () => {
    const create = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    const adapter = new BriefLlmAnthropicAdapter({ client: stubClient(create) });
    expect(await adapter.generateNarrative(SAMPLE_INPUT)).toBeNull();
  });

  it('returns null on an Anthropic.APIError (rate limit / 5xx) — never throws', async () => {
    const err = new Anthropic.RateLimitError(429, undefined, 'rate limited', new Headers());
    const create = vi.fn().mockRejectedValue(err);
    const adapter = new BriefLlmAnthropicAdapter({ client: stubClient(create) });
    expect(await adapter.generateNarrative(SAMPLE_INPUT)).toBeNull();
  });
});

describe('buildBriefLlmAdapter', () => {
  it('returns null when ANTHROPIC_API_KEY is unset', () => {
    expect(buildBriefLlmAdapter({})).toBeNull();
  });

  it('returns null when ANTHROPIC_API_KEY is an empty string', () => {
    expect(buildBriefLlmAdapter({ ANTHROPIC_API_KEY: '' })).toBeNull();
  });

  it('constructs the adapter when ANTHROPIC_API_KEY is present', () => {
    const adapter = buildBriefLlmAdapter({ ANTHROPIC_API_KEY: 'sk-ant-test-key' });
    expect(adapter).toBeInstanceOf(BriefLlmAnthropicAdapter);
  });
});
