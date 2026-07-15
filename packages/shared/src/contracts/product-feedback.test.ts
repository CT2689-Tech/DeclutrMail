import { describe, expect, it } from 'vitest';

import { ProductFeedbackRequestSchema } from './product-feedback';

const ID = '11111111-1111-4111-8111-111111111111';

describe('ProductFeedbackRequestSchema', () => {
  it.each([
    { surface: 'activity', referenceId: ID, rating: 'expected' },
    { surface: 'activity', referenceId: ID, rating: 'surprising' },
    { surface: 'brief', referenceId: ID, rating: 'useful' },
    { surface: 'brief', referenceId: ID, rating: 'not_useful' },
    { surface: 'brief', referenceId: ID, rating: 'wrong_reason' },
    { surface: 'followups', referenceId: ID, rating: 'useful' },
    { surface: 'followups', referenceId: ID, rating: 'not_followup' },
  ] as const)('accepts the bounded $surface/$rating pair', (value) => {
    expect(ProductFeedbackRequestSchema.parse(value)).toEqual(value);
  });

  it('rejects cross-surface ratings, invalid ids, and unknown fields', () => {
    expect(
      ProductFeedbackRequestSchema.safeParse({
        surface: 'activity',
        referenceId: ID,
        rating: 'useful',
      }).success,
    ).toBe(false);
    expect(
      ProductFeedbackRequestSchema.safeParse({
        surface: 'brief',
        referenceId: 'provider-thread-id',
        rating: 'useful',
      }).success,
    ).toBe(false);
    expect(
      ProductFeedbackRequestSchema.safeParse({
        surface: 'followups',
        referenceId: ID,
        rating: 'useful',
        subject: 'must never cross this boundary',
      }).success,
    ).toBe(false);
  });
});
