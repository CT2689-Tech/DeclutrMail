import { describe, expect, it } from 'vitest';

import { syncReminder24hEmail } from './sync-reminder-24h.js';

describe('sync-reminder-24h', () => {
  const input = {
    mailboxEmail: 'you@gmail.com',
    appUrl: 'https://app.declutrmail.com',
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
    expect(email.html).toContain('/triage');
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
