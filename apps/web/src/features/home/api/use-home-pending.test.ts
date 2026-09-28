import { describe, expect, it } from 'vitest';

import { selectHomeSenderPreviews } from './use-home-pending';

describe('selectHomeSenderPreviews', () => {
  it('skips historical-only senders before picking three current Inbox candidates', () => {
    const rows = [
      { senderId: 'old', senderName: 'Old newsletter', senderDomain: 'old.test', inboxCount: 0 },
      { senderId: 'one', senderName: 'One', senderDomain: 'one.test', inboxCount: 4 },
      { senderId: 'two', senderName: 'Two', senderDomain: 'two.test', inboxCount: 2 },
      { senderId: 'three', senderName: 'Three', senderDomain: 'three.test', inboxCount: 1 },
      { senderId: 'four', senderName: 'Four', senderDomain: 'four.test', inboxCount: 9 },
    ];

    expect(selectHomeSenderPreviews(rows)).toEqual([
      { id: 'one', name: 'One', domain: 'one.test', inboxCount: 4 },
      { id: 'two', name: 'Two', domain: 'two.test', inboxCount: 2 },
      { id: 'three', name: 'Three', domain: 'three.test', inboxCount: 1 },
    ]);
  });
});
