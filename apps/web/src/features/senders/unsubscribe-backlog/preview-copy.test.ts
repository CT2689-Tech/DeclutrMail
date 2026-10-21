import { describe, expect, it } from 'vitest';

import { bulkUnsubscribeTitle, unnamedUnsubscribeTitle } from './preview-copy';

const ONE_SENDER = 'Unsubscribe from 1 sender?';

describe('bulk unsubscribe titles', () => {
  it('never says "1 senders" and ignores the segment and the email count', () => {
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
      expect(title).toBe(ONE_SENDER);
      expect(title).not.toContain('1 senders');
      expect(title).not.toMatch(/email/i);
    }
  });

  it('uses the other form for more than one sender', () => {
    expect(bulkUnsubscribeTitle('unsub_only', 2, 0)).toBe('Unsubscribe from 2 senders?');
    expect(bulkUnsubscribeTitle('archive', 2, 10)).toBe('Unsubscribe from 2 senders?');
    expect(bulkUnsubscribeTitle('archive', 3, 1)).toBe('Unsubscribe from 3 senders?');
    expect(bulkUnsubscribeTitle('delete', 2, 1)).toBe('Unsubscribe from 2 senders?');
  });
});
