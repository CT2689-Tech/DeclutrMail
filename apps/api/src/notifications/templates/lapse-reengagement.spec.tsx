import { describe, expect, it, vi } from 'vitest';

import { lapseReengagementEmail } from './lapse-reengagement.js';

vi.mock('@declutrmail/shared/copy', () => ({
  postalAddressLine: () => '123 Test Street, Test City',
}));

function render(pendingCount: number) {
  return lapseReengagementEmail({
    pendingCount,
    appUrl: 'https://app.declutrmail.com',
    unsubscribeUrl: 'https://api.declutrmail.com/api/email/unsubscribe?t=tok',
  });
}

describe('lapse-reengagement', () => {
  it('renders D126 Part 3 as compliant plain text', () => {
    const email = render(4);

    expect(email.subject).toBe('4 senders are waiting in Triage');
    // D126 Part 3: "Plain text only; no marketing chrome."
    expect(email.html).toBeUndefined();
    expect(email.text.split('\n').slice(0, 6)).toEqual([
      '4 senders are waiting in Triage',
      '',
      'You have not opened DeclutrMail for five days. The queue held its',
      'place — every sender there is still waiting on your decision, not',
      'on us.',
      '',
    ]);
    expect(email.text).toContain('Open Triage: https://app.declutrmail.com/triage');
    // Commercial mail: visible opt-out AND postal address in the text
    // alternative, not only in the RFC 8058 header.
    expect(email.text).toContain(
      'Unsubscribe: https://api.declutrmail.com/api/email/unsubscribe?t=tok',
    );
    expect(email.text).toContain('Email preferences: https://app.declutrmail.com/settings');
    expect(email.text).toContain('123 Test Street, Test City');
  });

  it('uses the canonical K/A/U/L/D verbs (D227)', () => {
    expect(render(4).text).toContain(
      'One keystroke each: K to keep, A to archive, U to unsubscribe,',
    );
    // "Screen" is an internal enum only — never product copy.
    expect(render(4).text).not.toMatch(/\bScreen\b/);
  });

  /**
   * The email must not claim the mailbox was untouched while the user
   * was away: Autopilot in active mode acts without them, so that
   * reassurance would be false for exactly the users relying on it.
   */
  it('makes no claim about what happened to the inbox while away', () => {
    const text = render(4).text;
    expect(text).not.toMatch(/nothing (has been|was) (archived|deleted|touched)/i);
    expect(text).not.toMatch(/30 seconds|takes only|in seconds/i);
  });

  it('singularises a one-sender queue', () => {
    expect(render(1).subject).toBe('1 sender is waiting in Triage');
  });
});
