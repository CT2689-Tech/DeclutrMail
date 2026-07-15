import { describe, expect, it } from 'vitest';

import {
  initialUnsubscribeLifecycleStatus,
  normalizeUnsubscribeLifecycleStatus,
  UnsubscribeManualStatusRequestSchema,
} from './unsubscribe-lifecycle';

describe('unsubscribe lifecycle contract', () => {
  it('maps each unsubscribe method to an honest initial state', () => {
    expect(initialUnsubscribeLifecycleStatus('one_click')).toBe('requested');
    expect(initialUnsubscribeLifecycleStatus('mailto')).toBe('action_required');
    expect(initialUnsubscribeLifecycleStatus('none')).toBe('unavailable');
  });

  it('normalizes legacy persisted values without overstating success', () => {
    expect(normalizeUnsubscribeLifecycleStatus('pending')).toBe('requested');
    expect(normalizeUnsubscribeLifecycleStatus('done')).toBe('endpoint_accepted');
    expect(normalizeUnsubscribeLifecycleStatus('ambiguous')).toBe('unconfirmed');
    expect(normalizeUnsubscribeLifecycleStatus('failed')).toBe('failed');
    expect(normalizeUnsubscribeLifecycleStatus(null)).toBeNull();
  });

  it('accepts only explicit mailto progress transitions', () => {
    const senderId = '00000000-0000-4000-8000-000000000001';
    expect(
      UnsubscribeManualStatusRequestSchema.safeParse({ senderId, status: 'draft_opened' }).success,
    ).toBe(true);
    expect(
      UnsubscribeManualStatusRequestSchema.safeParse({ senderId, status: 'user_marked_sent' })
        .success,
    ).toBe(true);
    expect(
      UnsubscribeManualStatusRequestSchema.safeParse({ senderId, status: 'endpoint_accepted' })
        .success,
    ).toBe(false);
    expect(
      UnsubscribeManualStatusRequestSchema.safeParse({
        senderId,
        status: 'draft_opened',
        extra: true,
      }).success,
    ).toBe(false);
  });
});
