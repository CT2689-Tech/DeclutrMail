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

    expect(email.subject).toBe('4 senders are waiting on a decision');
    // D126 Part 3: "Plain text only; no marketing chrome."
    expect(email.html).toBeUndefined();
    expect(email.text.split('\n')[0]).toBe('4 senders are waiting on a decision');
    // The two recorded facts, and the caveat that the count spans
    // mailboxes while Triage shows one. Whitespace-flattened, so a
    // rewrap is not a failure.
    const flat = email.text.replace(/\s+/g, ' ');
    expect(flat).toContain('five days');
    expect(flat).toContain('across all your mailboxes');
    expect(flat).toContain('one mailbox at a time');
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
    const text = render(4).text;
    for (const key of [
      'K to keep',
      'A to archive',
      'U to unsubscribe',
      'L for later',
      'D to delete',
    ]) {
      expect(text).toContain(key);
    }
    // "Screen" is an internal enum only — never product copy.
    expect(text).not.toMatch(/\bScreen\b/);
  });

  it('makes no effort claim — only Keep lands in one key (D226)', () => {
    // A/U/L/D open the mandatory preview and confirm on a second press,
    // so "one keystroke each" was true of one verb in five.
    expect(render(4).text).not.toMatch(/keystroke|one key\b|single key/i);
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

  /**
   * The count is account-wide; the Triage read is per-mailbox and also
   * shows Keep and protected rows. The copy must therefore never assert
   * the two are the same number.
   */
  it('does not claim the count equals what the Triage screen shows', () => {
    const text = render(4).text;
    const normalized = text.replace(/\s+/g, ' ');
    expect(normalized).toContain('across all your mailboxes');
    expect(normalized).toContain('Triage shows one mailbox at a time');
    expect(text).not.toMatch(/waiting in Triage/);
  });

  it('singularises a one-sender queue', () => {
    expect(render(1).subject).toBe('1 sender is waiting on a decision');
  });
});
