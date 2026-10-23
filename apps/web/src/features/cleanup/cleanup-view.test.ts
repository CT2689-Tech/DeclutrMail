import { describe, expect, it } from 'vitest';
import { cleanupView, cleanupViewHref } from './cleanup-view';

describe('Cleanup view URLs', () => {
  it.each([null, undefined, '', 'unknown', 'screener'])('uses All senders for %s', (value) => {
    expect(cleanupView(value)).toBe('all');
  });

  it.each(['guided', 'first-review'] as const)('recognizes %s', (value) => {
    expect(cleanupView(value)).toBe(value);
  });

  it('changes only the view while preserving search, filters, repeated values and sort', () => {
    const search = '?q=field+notes&bucket=quiet&bucket=bulk&sort=total&dir=asc&view=guided';
    const review = new URL(cleanupViewHref('first-review', search), 'https://example.test');
    expect(review.pathname).toBe('/senders');
    expect(review.searchParams.get('q')).toBe('field notes');
    expect(review.searchParams.getAll('bucket')).toEqual(['quiet', 'bulk']);
    expect(review.searchParams.get('sort')).toBe('total');
    expect(review.searchParams.get('dir')).toBe('asc');
    expect(review.searchParams.get('view')).toBe('first-review');
    const all = new URL(cleanupViewHref('all', review.search), review);
    expect(all.searchParams.has('view')).toBe(false);
    expect(all.searchParams.get('q')).toBe('field notes');
    expect(all.searchParams.getAll('bucket')).toEqual(['quiet', 'bulk']);
  });

  it('does not leave a trailing query marker for the default view', () => {
    expect(cleanupViewHref('all', '?view=guided')).toBe('/senders');
  });
});
