import { describe, expect, it } from 'vitest';

import { getActionFailureCopy, technicalErrorDetails } from './action-error-copy';

describe('getActionFailureCopy', () => {
  it('makes a preview failure explicit and safe to retry', () => {
    expect(getActionFailureCopy('preview')).toEqual({
      title: 'Preview unavailable.',
      whatChanged: 'Nothing changed.',
      whatDidNotChange: 'No mail was moved and no request was sent.',
      nextStep: 'Retry the preview before confirming.',
      message:
        'Preview unavailable. Nothing changed. No mail was moved and no request was sent. Retry the preview before confirming.',
    });
  });

  it('distinguishes an accepted request with an unknown outcome from an enqueue failure', () => {
    expect(getActionFailureCopy('enqueue', { action: 'archive Acme' }).message).toContain(
      'The request was not accepted',
    );
    expect(getActionFailureCopy('status', { action: 'archive Acme' }).message).toContain(
      'The request was accepted, but its outcome is not confirmed',
    );
  });

  it('supports truthful partial-change overrides', () => {
    const copy = getActionFailureCopy('enqueue', {
      action: 'archive the backlog',
      whatChanged: 'The unsubscribe request was queued.',
      whatDidNotChange: 'The backlog was not archived.',
      nextStep: 'Archive the backlog from Senders.',
    });

    expect(copy.message).toBe(
      "Couldn't start archive the backlog. The unsubscribe request was queued. The backlog was not archived. Archive the backlog from Senders.",
    );
  });
});

describe('technicalErrorDetails', () => {
  it('keeps raw diagnostics available for a disclosure', () => {
    expect(technicalErrorDetails(new Error('request-id=abc'))).toBe('request-id=abc');
    expect(technicalErrorDetails(null)).toBe('No additional diagnostic details were provided.');
  });
});
