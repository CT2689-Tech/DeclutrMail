import { describe, expect, it } from 'vitest';

import { syncCompleteEmail } from './sync-complete.js';

describe('sync-complete', () => {
  const input = {
    mailboxEmail: 'you@gmail.com',
    messageCount: 24310,
    appUrl: 'https://app.declutrmail.com',
    unsubscribeUrl: 'https://api.declutrmail.com/api/email/unsubscribe?t=tok',
  };

  it('renders subject, text and html', async () => {
    const email = await syncCompleteEmail(input);
    expect(email.subject).toBe('Your inbox is ready');
    expect(email.text).toContain('24,310 emails');
    expect(email.text).toContain('you@gmail.com');
    expect(email.text).toContain('https://app.declutrmail.com/triage');
    expect(email.text).toContain('Still in setup?');
    expect(email.text).toContain('because you connected this mailbox');
    expect(email.html).toContain('24,310 emails');
    expect(email.html).toContain('https://app.declutrmail.com/triage');
  });

  it('names the count one way — "emails" in the text, html and preview', async () => {
    const email = await syncCompleteEmail(input);
    // Tags stripped, so the hero numeral and the noun in the NEXT element
    // read as one phrase, the way a reader sees them. Matching raw html
    // only ever saw the hidden preview — the visible noun sits after a
    // `</p><p>` and was invisible to it. Stripping also drops the
    // `x-apple-disable-message-reformatting` attribute.
    const visibleHtml = (email.html ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    for (const part of [email.text.replace(/\s+/g, ' '), visibleHtml]) {
      const nouns = [...part.matchAll(/24,310 (\w+)/g)].map((m) => m[1]);
      expect(nouns.length).toBeGreaterThan(0);
      expect(new Set(nouns)).toEqual(new Set(['emails']));
    }
    // Both the preview AND the visible body were checked, not just one.
    expect([...visibleHtml.matchAll(/24,310 emails/g)].length).toBeGreaterThanOrEqual(2);
  });

  it('promises no time or outcome it cannot measure', async () => {
    const email = await syncCompleteEmail(input);
    for (const part of [email.text, email.html]) {
      expect(part).not.toMatch(/usually|minutes?\b|bulk of/i);
    }
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

  it('carries a visible opt-out in BOTH the html and the text part', async () => {
    const email = await syncCompleteEmail(input);
    // CAN-SPAM §7704(a)(5) wants the opt-out explanation IN the message,
    // and GDPR Art. 21(2) wants it presented separately. The
    // List-Unsubscribe header does not discharge either, and most
    // clients outside Gmail render no native control at all.
    expect(email.html).toContain(input.unsubscribeUrl);
    expect(email.html).toContain('Unsubscribe');
    expect(email.text).toContain(`Unsubscribe: ${input.unsubscribeUrl}`);
    expect(email.text).toContain('Email preferences: https://app.declutrmail.com/settings');
  });
});
