import { describe, expect, it } from 'vitest';
import {
  UNSUB_AMBIGUOUS_REDIRECT_ERROR_CODE,
  UNSUB_MANUAL_REQUIRED_ERROR_CODE,
} from '@declutrmail/shared/contracts';

import { UNSUB_PILL, unsubscribeOutcomeToast } from './unsub-status';

describe('unsubscribeOutcomeToast', () => {
  it('names the email step when the sender refused one-click but takes email', () => {
    // UNSUB_MANUAL_REQUIRED is "Send from Gmail" on the row; the toast
    // said "failed — Archive still works" and hid the step that still
    // unsubscribes (one such job in production, 2026-09-19).
    const toast = unsubscribeOutcomeToast('Acme', {
      status: 'failed',
      errorCode: UNSUB_MANUAL_REQUIRED_ERROR_CODE,
    });
    expect(toast.message).toContain('send the unsubscribe email from Gmail');
    expect(toast.message).not.toMatch(/Archive still works/);
    expect(UNSUB_PILL.action_required.label).toBe('Send from Gmail');
  });

  it('keeps the unconfirmed and accepted outcomes distinct', () => {
    expect(
      unsubscribeOutcomeToast('Acme', {
        status: 'failed',
        errorCode: UNSUB_AMBIGUOUS_REDIRECT_ERROR_CODE,
      }),
    ).toEqual({
      message: 'Unsubscribe from Acme is unconfirmed — watch for new email.',
      tone: 'warn',
    });
    expect(unsubscribeOutcomeToast('Acme', { status: 'done', errorCode: null }).tone).toBe(
      'success',
    );
  });

  it('keeps Archive as the fallback for a genuine dead end', () => {
    const toast = unsubscribeOutcomeToast('Acme', {
      status: 'failed',
      errorCode: 'UNSUB_TARGET_REJECTED',
    });
    expect(toast).toEqual({
      message: 'Unsubscribe from Acme failed — Archive still works.',
      tone: 'warn',
    });
  });
});
