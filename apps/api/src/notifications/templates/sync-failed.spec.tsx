import { describe, expect, it } from 'vitest';

import { syncFailedEmail } from './sync-failed.js';

describe('sync-failed', () => {
  const input = {
    mailboxEmail: 'you@gmail.com',
    mailboxAccountId: 'mailbox-secondary',
    appUrl: 'https://app.declutrmail.com',
  };

  it('renders subject, text and html with the retry link', async () => {
    const email = await syncFailedEmail(input);
    expect(email.subject).toBe("We couldn't finish scanning you@gmail.com");
    expect(email.text).toContain('you@gmail.com');
    expect(email.text).toContain(
      'https://app.declutrmail.com/onboarding?mailbox=mailbox-secondary',
    );
    expect(email.html).toContain('you@gmail.com');
    expect(email.html).toContain(
      'https://app.declutrmail.com/onboarding?mailbox=mailbox-secondary',
    );
  });

  it('promises no automatic retry — that promise was the original lie', async () => {
    // The old gate copy said "We'll retry automatically", which was
    // false (first-run-trap audit 2026-07-28). This notice must state
    // the opposite and never regress.
    const email = await syncFailedEmail(input);
    expect(email.text).toContain('We will not retry on our own');
    expect(email.html).toContain('We will not retry on our own');
    expect(email.text).not.toMatch(/retry automatically|we('|&rsquo;)ll retry/i);
  });

  it('states what is preserved without overclaiming recovery', async () => {
    const email = await syncFailedEmail(input);
    // The plain-text part hard-wraps; compare whitespace-normalized.
    const flat = email.text.replace(/\s+/g, ' ');
    expect(flat).toContain('Nothing in your Gmail account was changed');
    expect(flat).toContain('anything already scanned is kept');
  });

  it('is a required notice — no unsubscribe framing anywhere (D165 system kind)', async () => {
    const email = await syncFailedEmail(input);
    expect(email.text).toContain('required account notice');
    expect(email.text).not.toMatch(/unsubscribe/i);
    expect(email.html).not.toMatch(/unsubscribe/i);
  });

  it('carries no message content (D7)', async () => {
    const email = await syncFailedEmail(input);
    expect(email.text).not.toMatch(/subject:/i);
    expect(email.html).not.toMatch(/snippet/i);
  });
});
