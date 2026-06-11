import { describe, expect, it } from 'vitest';

import {
  deletionReceiptEmail,
  deletionScheduledEmail,
  EMAIL_FROM,
  syncCompleteEmail,
  syncReminder24hEmail,
} from './email-templates.js';

/**
 * Template snapshots (D162). The rendered copy is a product surface —
 * any change must be deliberate (snapshot diff in review), and the
 * privacy assertions pin the D7/D228 posture: counts + dates + the
 * user's own address only, never message content.
 */

const APP_URL = 'https://app.declutrmail.com';

describe('email templates', () => {
  it('locks the From header (D162)', () => {
    expect(EMAIL_FROM).toBe('DeclutrMail <hello@send.declutrmail.com>');
  });

  it('sync-complete renders counts-only plain text', () => {
    const rendered = syncCompleteEmail({
      mailboxEmail: 'you@gmail.com',
      messageCount: 24310,
      appUrl: APP_URL,
    });
    expect(rendered).toMatchSnapshot();
    expect(rendered.text).toContain('24,310 messages');
    expect(rendered.text).toContain(`${APP_URL}/triage`);
  });

  it('sync-complete handles the singular count', () => {
    const rendered = syncCompleteEmail({
      mailboxEmail: 'you@gmail.com',
      messageCount: 1,
      appUrl: APP_URL,
    });
    expect(rendered.text).toContain('1 message indexed');
  });

  it('sync-reminder-24h renders with the settings opt-out pointer (D165)', () => {
    const rendered = syncReminder24hEmail({ mailboxEmail: 'you@gmail.com', appUrl: APP_URL });
    expect(rendered).toMatchSnapshot();
    expect(rendered.text).toContain(`${APP_URL}/settings`);
  });

  it('deletion-scheduled places the U22 cancel-link slot', () => {
    const rendered = deletionScheduledEmail({
      scheduledFor: 'June 18, 2026',
      cancelUrl: 'https://app.declutrmail.com/account/deletion/cancel?token=tok_123',
    });
    expect(rendered).toMatchSnapshot();
    expect(rendered.text).toContain(
      'https://app.declutrmail.com/account/deletion/cancel?token=tok_123',
    );
  });

  it('deletion-receipt renders', () => {
    const rendered = deletionReceiptEmail({ deletedAt: 'June 18, 2026' });
    expect(rendered).toMatchSnapshot();
  });

  it('privacy: no template ever interpolates message content slots', () => {
    // The full input surface of every template — if a future field adds
    // message-content capability, this enumeration forces a review.
    const rendered = [
      syncCompleteEmail({ mailboxEmail: 'you@gmail.com', messageCount: 5, appUrl: APP_URL }),
      syncReminder24hEmail({ mailboxEmail: 'you@gmail.com', appUrl: APP_URL }),
      deletionScheduledEmail({ scheduledFor: 'June 18, 2026', cancelUrl: `${APP_URL}/c` }),
      deletionReceiptEmail({ deletedAt: 'June 18, 2026' }),
    ];
    for (const email of rendered) {
      // Plain text only — never HTML.
      expect(email.text).not.toMatch(/<[a-z]+[\s>]/i);
      // D227 — "Screen" is never user-facing copy.
      expect(`${email.subject} ${email.text}`).not.toMatch(/\bscreen\b/i);
    }
  });
});
