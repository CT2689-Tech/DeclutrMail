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

  it('leads on the count as a hero numeral with lining figures', async () => {
    const email = await syncCompleteEmail(input);
    // The count is the news — it must render at display size with
    // lining+tabular figures, not buried mid-paragraph.
    expect(email.html).toMatch(/font-size:44px/);
    expect(email.html).toMatch(/lining-nums tabular-nums/);
  });

  it('anchors the mailbox address so Gmail cannot autolink it blue', async () => {
    const email = await syncCompleteEmail(input);
    // A bare address in body text gets autolinked by Gmail into default
    // blue underlined link text, which reads as a broken mailto.
    expect(email.html).toContain('mailto:you@gmail.com');
  });

  it('uses the brand teal CTA, never a pure-black button', async () => {
    const email = await syncCompleteEmail(input);
    expect(email.html).toMatch(/#006b5f/i);
    expect(email.html).not.toMatch(/background-color:#000000/i);
  });

  it('matches the snapshot', async () => {
    const email = await syncCompleteEmail(input);
    expect(email.text).toMatchSnapshot();
  });
});
