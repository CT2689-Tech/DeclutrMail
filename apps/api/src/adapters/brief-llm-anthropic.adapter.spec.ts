import Anthropic from '@anthropic-ai/sdk';
import type { BriefNarrativeInput } from '@declutrmail/workers';
import { describe, expect, it, vi } from 'vitest';

import {
  BriefLlmAnthropicAdapter,
  buildBriefLlmAdapter,
  narrativeWordBudget,
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
    },
  ],
  fyi: [
    {
      senderName: 'Bank',
      senderEmail: 'no-reply@bank.example',
      subject: 'Statement available',
      snippet: 'Your April statement is ready to view.',
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

describe('narrativeWordBudget', () => {
  // The budget scales with Reply length so that a genuinely heavy
  // morning gets room to state its reasons, WITHOUT handing the model
  // the decision. "Go longer when it matters" as a prompt rule is
  // self-granting — the model finds something that matters most days,
  // and the ceiling becomes the floor.
  it('holds the base budget for a light morning', () => {
    expect(narrativeWordBudget(0)).toBe(60);
    expect(narrativeWordBudget(1)).toBe(60);
    expect(narrativeWordBudget(2)).toBe(60);
  });

  it('buys ~one stated reason per Reply item past the second', () => {
    expect(narrativeWordBudget(3)).toBe(85);
    expect(narrativeWordBudget(4)).toBe(110);
    expect(narrativeWordBudget(5)).toBe(135);
  });

  it('caps at 150 — reached exactly at a full Reply section (D63 caps it at 6)', () => {
    expect(narrativeWordBudget(6)).toBe(150);
    expect(narrativeWordBudget(20)).toBe(150);
  });
});

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

  it("states the day's word budget to the model", () => {
    // SAMPLE_INPUT has one Reply item, so the base budget applies.
    expect(renderBriefUserPrompt(SAMPLE_INPUT)).toContain('Word budget: at most 60 words.');

    const heavy = {
      ...SAMPLE_INPUT,
      reply: Array.from({ length: 5 }, (_, i) => ({
        senderName: `Sender ${i}`,
        senderEmail: `s${i}@example.com`,
        subject: `Subject ${i}`,
        snippet: `Snippet ${i}`,
      })),
    };
    expect(renderBriefUserPrompt(heavy)).toContain('Word budget: at most 135 words.');
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

  it('the system prompt carries the constraints that encode decisions, not just voice', async () => {
    // These four rules are product decisions, not prose preferences, and
    // a future prompt edit should have to delete them on purpose:
    //   - length + "say what the list cannot" is why the narrative stopped
    //     being a ~100-word recap of the rows rendered directly beneath it;
    //   - "never state counts" stops it restating the section headers;
    //   - "never repeat figures from a snippet" stops a Bank of America
    //     balance ($4,284.44, observed on real mail 2026-08-25) being
    //     lifted out of an allowlisted snippet and rendered on the page.
    const create = vi.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'ok' }],
    } satisfies MockMessage);
    const adapter = new BriefLlmAnthropicAdapter({ client: stubClient(create) });
    await adapter.generateNarrative(SAMPLE_INPUT);

    const system = create.mock.calls[0]![0].system as string;
    expect(system).toContain('within the word budget stated at the end of the user message');
    expect(system).toContain('say what that list cannot');
    expect(system).toContain('Never state counts');
    expect(system).toContain('Never repeat figures from a snippet');

    // The number of senders named is decided by how many have a REASON,
    // never by a constant. An earlier draft capped it at "at most one
    // sender", which under-served exactly the morning the narrative
    // exists for — three real deadlines across three senders — and
    // repeated the "6 OF 6" mistake of dressing a fixed cap as a fact
    // about the day.
    expect(system).toContain('Name every item that has such a reason');
    expect(system).not.toContain('at most one sender');
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
