import { describe, expect, it } from 'vitest';

import { syncReminder24hEmail } from './sync-reminder-24h.js';

describe('sync-reminder-24h', () => {
  const input = {
    mailboxEmail: 'you@gmail.com',
    mailboxAccountId: '00000000-0000-4000-8000-000000000002',
    appUrl: 'https://app.declutrmail.com',
    onboarded: true,
    unsubscribeUrl: 'https://api.declutrmail.com/api/email/unsubscribe?t=tok',
  };

  it('promises no time or outcome it cannot measure', async () => {
    const email = await syncReminder24hEmail(input);
    for (const part of [email.text, email.html]) {
      expect(part).not.toMatch(/usually|minutes?\b|feel the difference/i);
    }
  });

  it('points opt-out at settings', async () => {
    const email = await syncReminder24hEmail(input);
    expect(email.subject).toBe('Your inbox is still ready');
    expect(email.text).toContain('https://app.declutrmail.com/settings');
    expect(email.html).toContain('/senders?mailbox=00000000-0000-4000-8000-000000000002');
    expect(email.text).toContain('from=sync_reminder_24h');
    expect(email.text).toContain('because you connected this Gmail account');
  });

  it('sends a user still in setup to onboarding', async () => {
    const email = await syncReminder24hEmail({ ...input, onboarded: false });
    expect(email.text).toContain('Finish setup: https://app.declutrmail.com/onboarding?');
    expect(email.html).not.toContain('/senders?');
  });

  it('carries a visible opt-out in BOTH the html and the text part', async () => {
    // The most clearly commercial of the four kinds — a re-engagement
    // nudge must never render without a visible opt-out.
    const email = await syncReminder24hEmail(input);
    expect(email.html).toContain(input.unsubscribeUrl);
    expect(email.html).toContain('Unsubscribe');
    expect(email.text).toContain(`Unsubscribe: ${input.unsubscribeUrl}`);
  });
});
