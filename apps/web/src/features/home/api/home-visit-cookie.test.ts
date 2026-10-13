import { describe, expect, it } from 'vitest';

import { HOME_VISIT_COOKIE, readHomeVisitCookie } from './home-visit-cookie';

const mailbox = 'e2eb1111-0000-4000-8000-000000000003';
const visitId = '10000000-0000-4000-8000-000000000001';

describe('home visit cookie', () => {
  it('reads a mailbox-scoped visit id and ignores a different mailbox', () => {
    const header = `${HOME_VISIT_COOKIE}=${encodeURIComponent(`${mailbox}:${visitId}`)}`;
    expect(readHomeVisitCookie(header, mailbox)).toBe(visitId);
    expect(readHomeVisitCookie(header, 'other-mailbox')).toBeNull();
    expect(readHomeVisitCookie('dm_access=token', mailbox)).toBeNull();
  });
});
