import { describe, expect, it } from 'vitest';
import { activityWeeklyReviewQueryOptions } from './query-options';
import { activityKeys } from './query-keys';

/**
 * The weekly card's counts are sender-scoped, so its query key is
 * partitioned by the sender filter. The server prefetch and the client
 * hook must therefore agree on that key: they diverged once during this
 * change and the card rendered "Loading weekly outcomes…" on every
 * filtered page load, because the hydrated cache entry sat under a key
 * nothing read.
 */
describe('activityWeeklyReviewQueryOptions — key partitioning', () => {
  const reader = async () => {
    throw new Error('not called');
  };

  it('keys on the sender filter so one sender cannot serve another', () => {
    expect(activityWeeklyReviewQueryOptions(reader, 'news@brand.com').queryKey).toEqual(
      activityKeys.weeklyReview('news@brand.com'),
    );
    expect(activityWeeklyReviewQueryOptions(reader, 'news@brand.com').queryKey).not.toEqual(
      activityWeeklyReviewQueryOptions(reader, 'other@brand.com').queryKey,
    );
  });

  it('uses one key for the unfiltered card whether the caller omits or empties the filter', () => {
    expect(activityWeeklyReviewQueryOptions(reader).queryKey).toEqual(
      activityWeeklyReviewQueryOptions(reader, '').queryKey,
    );
    expect(activityWeeklyReviewQueryOptions(reader).queryKey).toEqual(activityKeys.weeklyReview());
  });
});
