import { describe, expect, it } from 'vitest';

import { syncCompleteEmail } from './sync-complete.js';

describe('sync-complete', () => {
  const input = {
    mailboxEmail: 'you@gmail.com',
    messageCount: 24310,
    appUrl: 'https://app.declutrmail.com',
  };

  it('renders subject, text and html', async () => {
    const email = await syncCompleteEmail(input);
    expect(email.subject).toBe('Your inbox is ready');
    expect(email.text).toContain('24,310 messages');
    expect(email.text).toContain('you@gmail.com');
    expect(email.html).toContain('24,310 messages');
    expect(email.html).toContain('https://app.declutrmail.com/triage');
  });

  it('carries no message content (D7)', async () => {
    const email = await syncCompleteEmail(input);
    // Counts, dates, the user's own address and DeclutrMail URLs only.
    expect(email.text).not.toMatch(/subject:/i);
    expect(email.html).not.toMatch(/snippet/i);
  });

  it('matches the snapshot', async () => {
    const email = await syncCompleteEmail(input);
    expect(email.text).toMatchSnapshot();
  });
});
