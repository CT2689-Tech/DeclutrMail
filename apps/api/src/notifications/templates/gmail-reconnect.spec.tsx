import { describe, expect, it } from 'vitest';

import { gmailReconnectEmail } from './gmail-reconnect.js';

describe('gmail-reconnect', () => {
  const input = {
    mailboxEmail: 'you@gmail.com',
    mailboxAccountId: 'mailbox-1',
    appUrl: 'https://app.declutrmail.com',
  };

  it('asks for the Gmail permission instead of blaming an expiry', async () => {
    // `InvalidGrantError` is also a Gmail permission left unticked at
    // consent (403 insufficientPermissions) — the 2026-09-04 recipient's
    // case. "Needs renewing" named the wrong cause; the remedy must name
    // the permission, or a reconnect repeats the same grant.
    const email = await gmailReconnectEmail(input);
    for (const part of [email.text, email.html ?? '']) {
      expect(part).toContain('allow Gmail access');
      expect(part).not.toMatch(/renew|expired/i);
    }
  });

  it('pauses only syncing — Gmail actions on a refused grant fail, they do not wait', async () => {
    const email = await gmailReconnectEmail(input);
    for (const part of [email.text, email.html ?? '']) {
      expect(part).toContain('Updates for this Gmail account are paused');
      expect(part).not.toMatch(/Gmail actions/i);
    }
  });

  it('assumes no earlier sync — the inbox may never have finished one', async () => {
    const email = await gmailReconnectEmail(input);
    for (const part of [email.text, email.html ?? '']) {
      expect(part).not.toMatch(/previously synced/i);
    }
  });

  it('links the reconnect to the mailbox it names', async () => {
    const email = await gmailReconnectEmail(input);
    expect(email.subject).toBe('Reconnect Gmail for you@gmail.com');
    for (const part of [email.text, email.html ?? '']) {
      const raw = part
        .match(/https:\/\/app\.declutrmail\.com[^\s"'<>]*/)?.[0]
        ?.replaceAll('&amp;', '&');
      const url = new URL(raw ?? '');
      expect(url.pathname).toBe('/settings');
      expect(url.hash).toBe('#mailbox-mailbox-1');
      expect(url.searchParams.has('mailbox')).toBe(false);
      expect(part).not.toContain('mailbox=');
      expect(url.searchParams.get('from')).toBe('gmail_reconnect');
      expect(url.searchParams.get('utm_campaign')).toBe('gmail_reconnect');
    }
    expect(email.html).toContain('Open Gmail accounts');
  });
});
