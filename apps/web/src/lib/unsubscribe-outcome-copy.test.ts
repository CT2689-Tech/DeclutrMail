import {
  UNSUB_AMBIGUOUS_REDIRECT_ERROR_CODE,
  UNSUB_SENDER_PROTECTED_ERROR_CODE,
} from '@declutrmail/shared/contracts';
import { describe, expect, it } from 'vitest';

import { unsubscribeOutcomeToast } from './unsubscribe-outcome-copy';

describe('unsubscribeOutcomeToast', () => {
  it('states only what an accepted request proves', () => {
    const [message, tone] = unsubscribeOutcomeToast('Acme', { status: 'done', errorCode: null });
    expect(message).toContain('Acme accepted the unsubscribe request');
    expect(message).not.toMatch(/\bUnsubscribed\b/);
    expect(tone).toBe('success');
  });

  it('keeps a redirect unconfirmed, never a success', () => {
    const [message, tone] = unsubscribeOutcomeToast('Acme', {
      status: 'failed',
      errorCode: UNSUB_AMBIGUOUS_REDIRECT_ERROR_CODE,
    });
    expect(message).toContain('unconfirmed');
    expect(tone).toBe('warn');
  });

  it('says a request refused as Protected was not sent, never that it failed (D245)', () => {
    const [message, tone] = unsubscribeOutcomeToast('Acme', {
      status: 'failed',
      errorCode: UNSUB_SENDER_PROTECTED_ERROR_CODE,
    });
    expect(message).toContain('not sent');
    expect(message).toContain('Protected');
    expect(message).not.toMatch(/failed/i);
    expect(tone).toBe('info');
  });

  it('reports any other terminal failure as failed', () => {
    const [message, tone] = unsubscribeOutcomeToast('Acme', {
      status: 'failed',
      errorCode: 'UNSUB_TARGET_REJECTED',
    });
    expect(message).toContain('Unsubscribe from Acme failed');
    expect(tone).toBe('warn');
  });
});
