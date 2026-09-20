import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api/client';

import { getActionFailureCopy, technicalErrorDetails } from './action-error-copy';

const PHASES = [
  'preview',
  'enqueue',
  'status',
  'terminal',
  'revert-enqueue',
  'revert-status',
  'revert-terminal',
] as const;

describe('getActionFailureCopy', () => {
  it.each(PHASES)('keeps %s to the one-sentence toast budget', (phase) => {
    const copy = getActionFailureCopy(phase, { action: 'Archive for Acme' });
    // One sentence: a single terminal period, nothing after it.
    expect(copy.match(/[.!?](\s|$)/g)).toHaveLength(1);
    expect(copy.endsWith('.')).toBe(true);
  });

  it('says nothing changed only when the request was never accepted', () => {
    expect(getActionFailureCopy('enqueue', { action: 'Archive for Acme' })).toMatch(
      /start Archive for Acme.*nothing changed/,
    );
    expect(getActionFailureCopy('revert-enqueue')).toMatch(/start undo.*nothing changed/);
    for (const phase of ['status', 'terminal', 'revert-status', 'revert-terminal'] as const) {
      expect(getActionFailureCopy(phase)).not.toMatch(/nothing changed/);
    }
  });

  it('sends an unconfirmed outcome to Activity before a retry', () => {
    for (const phase of ['status', 'terminal', 'revert-status', 'revert-terminal'] as const) {
      expect(getActionFailureCopy(phase, { action: 'Archive for Acme' })).toMatch(
        /check Activity before retrying/,
      );
    }
    expect(getActionFailureCopy('status', { action: 'Archive for Acme' })).toMatch(
      /confirm Archive for Acme/,
    );
    expect(getActionFailureCopy('terminal', { action: 'the Noise archive' })).toMatch(
      /^The Noise archive failed/,
    );
  });

  it('leads a partial batch with the confirmed split', () => {
    const copy = getActionFailureCopy('terminal', {
      action: 'Archive',
      partial: { done: 3, total: 5, unit: 'senders' },
    });
    expect(copy).toMatch(/^Archive: 3 of 5 senders completed/);
    expect(copy).toMatch(/Activity/);
    expect(copy).not.toMatch(/failed/);
  });

  it('lets a surface replace the clause after the dash', () => {
    const copy = getActionFailureCopy('revert-terminal', {
      partial: { done: 2, total: 3, unit: 'undos' },
      outcome: 'use Try again on each failed row',
    });
    expect(copy).toBe('2 of 3 undos completed — use Try again on each failed row.');
  });
});

describe('technicalErrorDetails', () => {
  it('keeps raw diagnostics available for a disclosure', () => {
    expect(technicalErrorDetails(new Error('request-id=abc'))).toBe('request-id=abc');
    expect(technicalErrorDetails(null)).toBe('No additional diagnostic details were provided.');
  });

  it('appends the D168 support code when the error envelope carries one', () => {
    const err = new ApiError(
      409,
      { error: { code: 'PROTECTED_SENDER', displayId: 'DM-7F2A91' } },
      'Conflict',
    );
    expect(technicalErrorDetails(err)).toBe('Conflict (Support code: DM-7F2A91)');
  });

  it('omits the support code suffix when the envelope has none', () => {
    const err = new ApiError(500, 'plain text', 'boom');
    expect(technicalErrorDetails(err)).toBe('boom');
  });
});
