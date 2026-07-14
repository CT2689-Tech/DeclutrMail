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

  it('singular/plural agreement on reply count', () => {
    expect(
      renderTemplateNarrative({
        reply: [sampleItem()],
        fyi: [],
        noise: [],
      }),
    ).toBe('1 email needs a reply.');
    expect(
      renderTemplateNarrative({
        reply: [sampleItem(), sampleItem({ senderKey: 'b'.repeat(64) })],
        fyi: [],
        noise: [],
      }),
    ).toBe('2 emails need replies.');
  });

  it('composes a comma-joined summary across all three sections', () => {
    expect(
      renderTemplateNarrative({
        reply: [sampleItem()],
        fyi: [sampleItem({ senderKey: 'c'.repeat(64) })],
        noise: [sampleNoiseGroup()],
      }),
    ).toBe('1 email needs a reply, 1 FYI, 3 messages you can archive.');
  });

  it('omits sections whose count is zero', () => {
    expect(
      renderTemplateNarrative({
        reply: [],
        fyi: [sampleItem()],
        noise: [sampleNoiseGroup({ messageCount: 1 })],
      }),
    ).toBe('1 FYI, 1 message you can archive.');
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
