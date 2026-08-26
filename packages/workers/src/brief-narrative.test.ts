import { describe, expect, it } from 'vitest';

import {
  BRIEF_FYI_MAX,
  BRIEF_REPLY_MAX,
  briefPayloadSchema,
  DEFAULT_BRIEF_LLM_TIMEOUT_MS,
  EMPTY_BRIEF_NARRATIVE,
  EMPTY_BRIEF_PAYLOAD,
  renderTemplateNarrative,
  resolveBriefLlmTimeoutMs,
} from './brief-narrative.js';

/**
 * Unit tests for the D62 narrative module + the D63 Zod validator.
 *
 * The integration-level tests in `brief-snapshot.worker.test.ts` cover
 * the worker's end-to-end orchestration; these tests pin the pure
 * functions + the schema contract so a future refactor of either can't
 * silently drift.
 */

const sampleItem = (overrides: Record<string, unknown> = {}) => ({
  senderKey: 'a'.repeat(64),
  senderName: 'Sender',
  senderEmail: 'sender@example.com',
  subject: 'subject',
  messageIds: ['msg-1'],
  ...overrides,
});

const sampleNoiseGroup = (overrides: Record<string, unknown> = {}) => ({
  senderKey: 'b'.repeat(64),
  senderName: 'Promo',
  messageCount: 3,
  messageIds: ['msg-1', 'msg-2', 'msg-3'],
  ...overrides,
});

describe('renderTemplateNarrative', () => {
  it('returns the D70 calm copy verbatim on an empty day', () => {
    expect(renderTemplateNarrative({ reply: [], fyi: [], noise: [] })).toBe(EMPTY_BRIEF_NARRATIVE);
  });

  it('says nothing on a day that has mail — the lists already say it', () => {
    // This replaces three tests that pinned "1 email needs a reply,
    // 1 FYI, 3 messages you can archive." Every one of those numbers is
    // restated verbatim by the section header rendered directly below
    // the narrative, so the sentence added reading cost and no
    // information. A deterministic template has no judgment to offer,
    // and #635 re-scoped the narrative to judgment only — so the honest
    // output is nothing.
    expect(
      renderTemplateNarrative({
        reply: [sampleItem()],
        fyi: [sampleItem({ senderKey: 'c'.repeat(64) })],
        noise: [sampleNoiseGroup()],
      }),
    ).toBe('');

    // Any single non-empty section behaves the same way.
    expect(renderTemplateNarrative({ reply: [sampleItem()], fyi: [], noise: [] })).toBe('');
    expect(renderTemplateNarrative({ reply: [], fyi: [sampleItem()], noise: [] })).toBe('');
    expect(renderTemplateNarrative({ reply: [], fyi: [], noise: [sampleNoiseGroup()] })).toBe('');
  });

  it('still speaks on a genuinely empty day (D70)', () => {
    // The one case where the template is the only thing on screen:
    // there are no lists to read, so silence would leave a blank Brief.
    expect(renderTemplateNarrative({ reply: [], fyi: [], noise: [] })).toBe(EMPTY_BRIEF_NARRATIVE);
    expect(EMPTY_BRIEF_NARRATIVE.trim().length).toBeGreaterThan(0);
  });
});

describe('briefPayloadSchema (D63)', () => {
  it('accepts a well-formed empty payload', () => {
    expect(() => briefPayloadSchema.parse(EMPTY_BRIEF_PAYLOAD)).not.toThrow();
  });

  it('accepts a well-formed payload with caps respected', () => {
    expect(() =>
      briefPayloadSchema.parse({
        reply: Array.from({ length: BRIEF_REPLY_MAX }, () => sampleItem()),
        fyi: Array.from({ length: BRIEF_FYI_MAX }, () => sampleItem()),
        noise: [sampleNoiseGroup()],
        narrative: 'hi',
      }),
    ).not.toThrow();
  });

  it('rejects a reply array above the D63 cap', () => {
    expect(() =>
      briefPayloadSchema.parse({
        reply: Array.from({ length: BRIEF_REPLY_MAX + 1 }, () => sampleItem()),
        fyi: [],
        noise: [],
        narrative: '',
      }),
    ).toThrow();
  });

  it('rejects an fyi array above the D63 cap', () => {
    expect(() =>
      briefPayloadSchema.parse({
        reply: [],
        fyi: Array.from({ length: BRIEF_FYI_MAX + 1 }, () => sampleItem()),
        noise: [],
        narrative: '',
      }),
    ).toThrow();
  });

  it('rejects a payload with extra top-level keys (strict)', () => {
    expect(() =>
      briefPayloadSchema.parse({
        reply: [],
        fyi: [],
        noise: [],
        narrative: '',
        // D63 specifies EXACTLY three sections. A "screen" section
        // would violate the contract; the schema rejects.
        screen: [],
      }),
    ).toThrow();
  });

  it('rejects a BriefItem carrying a stowaway snippet (privacy: D7)', () => {
    expect(() =>
      briefPayloadSchema.parse({
        reply: [sampleItem({ snippet: 'should not be here' })],
        fyi: [],
        noise: [],
        narrative: '',
      }),
    ).toThrow();
  });

  it('rejects a noise group missing required fields', () => {
    expect(() =>
      briefPayloadSchema.parse({
        reply: [],
        fyi: [],
        noise: [{ senderKey: 'b'.repeat(64), senderName: 'x' }],
        narrative: '',
      }),
    ).toThrow();
  });
});

describe('resolveBriefLlmTimeoutMs', () => {
  it('returns the default when the env var is unset', () => {
    expect(resolveBriefLlmTimeoutMs(undefined)).toBe(DEFAULT_BRIEF_LLM_TIMEOUT_MS);
  });

  it('returns the parsed value when set', () => {
    expect(resolveBriefLlmTimeoutMs('250')).toBe(250);
  });

  it('falls back to the default for garbage values', () => {
    expect(resolveBriefLlmTimeoutMs('not-a-number')).toBe(DEFAULT_BRIEF_LLM_TIMEOUT_MS);
    expect(resolveBriefLlmTimeoutMs('0')).toBe(DEFAULT_BRIEF_LLM_TIMEOUT_MS);
    expect(resolveBriefLlmTimeoutMs('-5')).toBe(DEFAULT_BRIEF_LLM_TIMEOUT_MS);
  });
});
