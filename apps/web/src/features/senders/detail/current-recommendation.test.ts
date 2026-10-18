import { describe, expect, it } from 'vitest';
import type { Recommendation } from './types';
import { currentRecommendation } from './current-recommendation';

const facts = {
  isProtected: false,
  policyType: null,
  unsubStatus: null,
  inboxCount: 21,
  archivedCount: 7,
} as const;
const recommendation = (verdict: Recommendation['verdict']) => ({ verdict });

describe('suggestions against current sender facts', () => {
  it.each([
    'requested',
    'endpoint_accepted',
    'unconfirmed',
    'action_required',
    'draft_opened',
    'user_marked_sent',
    'unavailable',
  ] as const)('does not repeat an unsubscribe already represented by %s', (unsubStatus) => {
    expect(
      currentRecommendation(recommendation('unsubscribe'), {
        ...facts,
        policyType: 'unsubscribe',
        unsubStatus,
      }),
    ).toBeNull();
  });
  it.each(['failed', null] as const)(
    'does not call an unsubscribe completed from %s',
    (unsubStatus) => {
      const read = recommendation('unsubscribe');
      expect(currentRecommendation(read, { ...facts, unsubStatus })).toBe(read);
    },
  );
  it.each(['keep', 'archive', 'unsubscribe', 'later', 'delete'] as const)(
    'honors a standing Keep over an old %s suggestion',
    (verdict) => {
      expect(
        currentRecommendation(recommendation(verdict), { ...facts, policyType: 'keep' }),
      ).toBeNull();
    },
  );
  it('honors current protection without changing the stored read', () => {
    const read = recommendation('archive');
    expect(currentRecommendation(read, { ...facts, isProtected: true })).toBeNull();
    expect(read).toEqual({ verdict: 'archive' });
    expect(currentRecommendation(read, facts)).toBe(read);
  });
  it.each(['archive', 'later'] as const)(
    'retires %s when inbox is empty and restores it for partial cleanup, new mail or Undo',
    (verdict) => {
      const read = recommendation(verdict);
      expect(currentRecommendation(read, { ...facts, inboxCount: 0 })).toBeNull();
      expect(currentRecommendation(read, { ...facts, inboxCount: 7 })).toBe(read);
      expect(currentRecommendation(read, { ...facts, inboxCount: null })).toBe(read);
      expect(currentRecommendation(read, { ...facts, inboxCount: undefined })).toBe(read);
    },
  );
  it('retires Delete only with known zero current mail, preserving partial/unknown mail', () => {
    const read = recommendation('delete');
    expect(currentRecommendation(read, { ...facts, inboxCount: 0, archivedCount: 0 })).toBeNull();
    expect(currentRecommendation(read, { ...facts, inboxCount: 0, archivedCount: 7 })).toBe(read);
    expect(currentRecommendation(read, { ...facts, inboxCount: 0, archivedCount: null })).toBe(
      read,
    );
  });
  it.each([
    'requested',
    'action_required',
    'draft_opened',
    'unconfirmed',
    'endpoint_accepted',
    'user_marked_sent',
    'failed',
    'unavailable',
    null,
  ] as const)(
    'does not contradict an explicit unsubscribe choice with an old Keep read (%s)',
    (unsubStatus) => {
      expect(
        currentRecommendation(recommendation('keep'), {
          ...facts,
          policyType: 'unsubscribe',
          unsubStatus,
        }),
      ).toBeNull();
    },
  );
  it('keeps the legacy unknown-outcome intent in its lifecycle rather than a repeat suggestion', () => {
    expect(
      currentRecommendation(recommendation('unsubscribe'), {
        ...facts,
        policyType: 'unsubscribe',
        unsubStatus: null,
      }),
    ).toBeNull();
  });
  it('does not treat Delete or Archive as an unsubscribe from future mail', () => {
    const read = recommendation('unsubscribe');
    expect(currentRecommendation(read, { ...facts, inboxCount: 0, archivedCount: 0 })).toBe(read);
  });
  it('does not invent a suggestion when none was scored', () => {
    expect(currentRecommendation(null, facts)).toBeNull();
  });
});
