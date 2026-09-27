import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api/client';

import {
  actionLabel,
  enqueueMayHaveStarted,
  getActionFailureCopy,
  stillRunningCopy,
  technicalErrorDetails,
} from './action-error-copy';

/** A failure as the API writes it (`AllExceptionsFilter`), or a bare body. */
function apiError(status: number, code: string | null): ApiError {
  return new ApiError(
    status,
    { error: code === null ? { message: 'Bad Gateway' } : { code, message: code } },
    `POST /api/actions failed: ${status}`,
  );
}
/** A refusal: the API answered before anything started. */
const refused = apiError(400, 'VALIDATION_FAILED');

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
    const copy = getActionFailureCopy(phase, { action: 'Archive for Acme', error: refused });
    // One sentence: a single terminal period, nothing after it.
    expect(copy.match(/[.!?](\s|$)/g)).toHaveLength(1);
    expect(copy.endsWith('.')).toBe(true);
  });

  it('says nothing changed only when the request was never accepted', () => {
    expect(getActionFailureCopy('enqueue', { action: 'Archive for Acme', error: refused })).toMatch(
      /start Archive for Acme.*nothing changed/,
    );
    expect(getActionFailureCopy('revert-enqueue', { error: refused })).toMatch(
      /start undo.*nothing changed/,
    );
    for (const phase of ['status', 'terminal', 'revert-status', 'revert-terminal'] as const) {
      expect(getActionFailureCopy(phase)).not.toMatch(/nothing changed/);
    }
  });

  // The queue did not confirm the add (a timed-out reply leaves the job
  // running), or nothing answered at all: a retry could run it twice.
  it('never says nothing changed when the job may have started', () => {
    for (const error of [
      apiError(503, 'ENQUEUE_FAILED'),
      // The failure write after a landed add can itself throw.
      apiError(500, 'INTERNAL_ERROR'),
      new TypeError('Failed to fetch'),
      apiError(504, null),
      undefined,
    ]) {
      expect(getActionFailureCopy('enqueue', { action: 'Archive for Acme', error })).toBe(
        "Can't tell if Archive for Acme started — check Activity before retrying.",
      );
      expect(getActionFailureCopy('revert-enqueue', { error })).toBe(
        "Can't tell if undo started — try again.",
      );
    }
  });

  it('drops a refined "nothing changed" when that is unproven', () => {
    const copy = (error: unknown) =>
      getActionFailureCopy('enqueue', {
        action: 'Unsubscribe for Acme',
        outcome: 'no request was sent',
        error,
      });
    expect(copy(refused)).toBe("Couldn't start Unsubscribe for Acme — no request was sent.");
    expect(copy(apiError(503, 'ENQUEUE_FAILED'))).toBe(
      "Can't tell if Unsubscribe for Acme started — check Activity before retrying.",
    );
  });

  // An undo request is idempotent: the same token answers with the same
  // reverse job, or "reverted" once it finished. Trying again is safe.
  it('says an unconfirmed undo may simply be tried again', () => {
    expect(getActionFailureCopy('revert-status')).toBe("Couldn't confirm undo — try again.");
  });

  it('sends an unconfirmed outcome to Activity before a retry', () => {
    for (const phase of ['status', 'terminal', 'revert-terminal'] as const) {
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

// "Later" names the verb; as an English word "start Later" means "begin
// afterwards". Every sentence built from a verb says what Later does.
describe('actionLabel', () => {
  it('names Later by what it does', () => {
    expect(actionLabel('Archive', 'Acme')).toBe('Archive for Acme');
    expect(actionLabel('Later', 'Acme')).toBe('moving email from Acme to Later');
    expect(
      getActionFailureCopy('enqueue', { action: actionLabel('Later', 'Acme'), error: refused }),
    ).toBe("Couldn't start moving email from Acme to Later — nothing changed.");
    expect(getActionFailureCopy('terminal', { action: actionLabel('Later', '3 senders') })).toBe(
      'Moving email from 3 senders to Later failed — check Activity before retrying.',
    );
  });

  it('opens an overdue status with the action', () => {
    expect(stillRunningCopy('Delete', 'Acme')).toBe(
      'Delete for Acme is still running — see Activity.',
    );
    expect(stillRunningCopy('Later', 'the acme.com batch')).toBe(
      'Moving email from the acme.com batch to Later is still running — see Activity.',
    );
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

describe('enqueueMayHaveStarted', () => {
  it('is false only for a refusal', () => {
    expect(enqueueMayHaveStarted(refused)).toBe(false);
    expect(enqueueMayHaveStarted(apiError(409, 'NO_ACTIONABLE_SENDERS'))).toBe(false);
    // A 4xx the API did not write still refused the request.
    expect(enqueueMayHaveStarted(apiError(413, null))).toBe(false);
  });

  it('is true for any 5xx, or when nothing answered', () => {
    expect(enqueueMayHaveStarted(apiError(503, 'ENQUEUE_FAILED'))).toBe(true);
    expect(enqueueMayHaveStarted(apiError(500, 'INTERNAL_ERROR'))).toBe(true);
    expect(enqueueMayHaveStarted(new TypeError('Failed to fetch'))).toBe(true);
    expect(enqueueMayHaveStarted(apiError(502, null))).toBe(true);
    expect(enqueueMayHaveStarted(undefined)).toBe(true);
  });
});
