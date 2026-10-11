import { describe, expect, it } from 'vitest';

import { connectedFooter, fillWs4, SYNC_FAILED_NOTICE_WHILE_RETRYING } from './ws4-fill';
import { WS4_COPY } from './ws4';

describe('ws4 fill', () => {
  it('fills the connection term and leaves the retrying variant unsent', () => {
    expect(connectedFooter('this')).toBe(
      'You received this because you connected this Gmail account to DeclutrMail.',
    );
    expect(connectedFooter('a')).toBe(
      'You received this because you connected a Gmail account to DeclutrMail.',
    );
    expect(SYNC_FAILED_NOTICE_WHILE_RETRYING).toBe(false);
    expect(fillWs4(WS4_COPY.email.weekly.brief.one)).toContain('Daily Brief');
  });
});
