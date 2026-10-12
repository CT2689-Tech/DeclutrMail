import { describe, expect, it } from 'vitest';

import { bulkUnsubscribeTitle, unnamedUnsubscribeTitle } from './preview-copy';

describe('bulk unsubscribe titles', () => {
  it('never says "1 senders"', () => {
    const titles = [
      bulkUnsubscribeTitle('unsub_only', 1, 0),
      bulkUnsubscribeTitle('archive', 1, 1),
      bulkUnsubscribeTitle('archive', 1, 4),
      bulkUnsubscribeTitle('delete', 1, 1),
      bulkUnsubscribeTitle('delete', 1, 12),
      unnamedUnsubscribeTitle('archive', 4),
      unnamedUnsubscribeTitle('delete', 1),
      unnamedUnsubscribeTitle('unsub_only', 0),
    ];
    for (const title of titles) {
      expect(title).not.toContain('1 senders');
    }
    expect(bulkUnsubscribeTitle('unsub_only', 1, 0)).toBe('Unsubscribe from 1 sender?');
    expect(bulkUnsubscribeTitle('archive', 1, 1)).toBe(
      'Unsubscribe from 1 sender and archive 1 email?',
    );
    expect(bulkUnsubscribeTitle('archive', 1, 4)).toBe(
      'Unsubscribe from 1 sender and archive 4 emails?',
    );
    expect(bulkUnsubscribeTitle('delete', 1, 1)).toBe(
      'Unsubscribe from 1 sender and delete 1 email?',
    );
    expect(unnamedUnsubscribeTitle('archive', 4)).toBe(
      'Unsubscribe from 1 sender and archive 4 emails?',
    );
  });

  it('uses the other form for more than one sender, and pluralizes the email count', () => {
    expect(bulkUnsubscribeTitle('unsub_only', 2, 0)).toBe('Unsubscribe from 2 senders?');
    expect(bulkUnsubscribeTitle('archive', 2, 10)).toBe(
      'Unsubscribe from 2 senders and archive 10 emails?',
    );
    expect(bulkUnsubscribeTitle('archive', 3, 1)).toBe(
      'Unsubscribe from 3 senders and archive 1 email?',
    );
    expect(bulkUnsubscribeTitle('delete', 2, 1)).toBe(
      'Unsubscribe from 2 senders and delete 1 email?',
    );
  });
});
