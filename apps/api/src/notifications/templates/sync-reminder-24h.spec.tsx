import { describe, expect, it } from 'vitest';

import { syncReminder24hEmail } from './sync-reminder-24h.js';

describe('sync-reminder-24h', () => {
  it('points opt-out at settings', async () => {
    const email = await syncReminder24hEmail({
      mailboxEmail: 'you@gmail.com',
      appUrl: 'https://app.declutrmail.com',
    });
    expect(email.subject).toBe('Your inbox is still ready');
    expect(email.text).toContain('https://app.declutrmail.com/settings');
    expect(email.html).toContain('/triage');
  });
});
