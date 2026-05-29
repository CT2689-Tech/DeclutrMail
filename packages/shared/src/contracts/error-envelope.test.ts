import { describe, expect, it } from 'vitest';

import { classifyHttpError, deriveDisplayId } from './error-envelope';

describe('deriveDisplayId (D168)', () => {
  it('derives a DM-XXXXXX code from the first 6 hex of the correlationId', () => {
    expect(deriveDisplayId('7f2a91d4-0000-4000-8000-000000000000')).toBe('DM-7F2A91');
  });

  it('is deterministic for the same correlationId', () => {
    const id = 'abcdef12-3456-4789-8abc-def012345678';
    expect(deriveDisplayId(id)).toBe(deriveDisplayId(id));
  });
});

describe('classifyHttpError (D169)', () => {
  it('marks 5xx / 408 / 429 as retryable', () => {
    expect(classifyHttpError(500).retryable).toBe(true);
    expect(classifyHttpError(503).retryable).toBe(true);
    expect(classifyHttpError(408).retryable).toBe(true);
    expect(classifyHttpError(429).retryable).toBe(true);
  });

  it('marks deterministic 4xx as non-retryable', () => {
    expect(classifyHttpError(400).retryable).toBe(false);
    expect(classifyHttpError(401).retryable).toBe(false);
    expect(classifyHttpError(404).retryable).toBe(false);
    expect(classifyHttpError(409).retryable).toBe(false);
  });

  it('defaults everything that reaches the client to inline_recoverable', () => {
    expect(classifyHttpError(400).severityTier).toBe('inline_recoverable');
    expect(classifyHttpError(500).severityTier).toBe('inline_recoverable');
  });
});
