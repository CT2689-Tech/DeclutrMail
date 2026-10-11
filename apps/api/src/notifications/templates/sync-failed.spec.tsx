import { describe, expect, it } from 'vitest';

import { syncFailedEmail } from './sync-failed.js';

describe('sync-failed', () => {
  const input = {
    mailboxEmail: 'you@gmail.com',
    mailboxAccountId: 'mailbox-secondary',
    appUrl: 'https://app.declutrmail.com',
    errorCode: 'PermanentError',
  };

  it('does not invite a reply no person would receive', async () => {
    // Sends carry no Reply-To until EMAIL_REPLY_TO names a verified
    // mailbox; a reply to the From address reaches a bounce handler.
    const email = await syncFailedEmail(input);
    for (const part of [email.text, email.html]) {
      expect(part).not.toMatch(/reply to this email/i);
    }
  });

  it('renders subject, text and html with the retry link', async () => {
    const email = await syncFailedEmail(input);
    expect(email.subject).toBe('We couldn’t finish scanning you@gmail.com');
    expect(email.text).toContain('you@gmail.com');
    expect(email.text).toContain(
      'https://app.declutrmail.com/onboarding?mailbox=mailbox-secondary',
    );
    expect(email.html).toContain('you@gmail.com');
    expect(email.html).toContain(
      'https://app.declutrmail.com/onboarding?mailbox=mailbox-secondary',
    );
  });

  it('uses the permanent variant and never the pending retrying sentence', async () => {
    const email = await syncFailedEmail(input);
    expect(email.text).toContain('This scan can’t continue.');
    expect(email.text).toContain('Resume your scan:');
    expect(email.text).not.toContain('email you when your inbox is ready');
    expect(email.html).not.toContain('email you when your inbox is ready');
  });

  it('asks for a reconnect when the grant is gone', async () => {
    const email = await syncFailedEmail({ ...input, errorCode: 'InvalidGrantError' });
    expect(email.text).toContain('no longer has permission');
    expect(email.text).toContain('Reconnect Gmail:');
    expect(email.html).toContain('Reconnect Gmail');
  });

  it('says the automatic tries are spent for a transient error', async () => {
    const email = await syncFailedEmail({ ...input, errorCode: 'RateLimitError' });
    expect(email.text).toContain('won’t try again on its own');
    expect(email.text).not.toContain('email you when your inbox is ready');
  });

  it('states what is preserved without overclaiming recovery', async () => {
    const email = await syncFailedEmail(input);
    const flat = email.text.replace(/\s+/g, ' ');
    expect(flat).toContain('Nothing in your Gmail was changed');
    expect(flat).toContain('everything already scanned is kept');
  });

  it('is a required notice — no unsubscribe framing anywhere (D165 system kind)', async () => {
    const email = await syncFailedEmail(input);
    expect(email.text).toContain('This is a required account notice. It can’t be turned off.');
    expect(email.text).not.toMatch(/unsubscribe/i);
    expect(email.html).not.toMatch(/unsubscribe/i);
  });

  it('carries no message content (D7)', async () => {
    const email = await syncFailedEmail(input);
    expect(email.text).not.toMatch(/subject:/i);
    expect(email.html).not.toMatch(/snippet/i);
  });
});
