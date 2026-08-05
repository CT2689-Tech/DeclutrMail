import { describe, expect, it, vi } from 'vitest';

import { weeklyValueReceiptEmail } from './weekly-value-receipt.js';

vi.mock('@declutrmail/shared/copy', () => ({
  postalAddressLine: () => '123 Test Street, Test City',
}));

describe('weekly-value-receipt', () => {
  it('renders the locked Plus/Pro weekly cue as compliant plain text', () => {
    const email = weeklyValueReceiptEmail({
      pendingCount: 7,
      appUrl: 'https://app.declutrmail.com',
      unsubscribeUrl: 'https://api.declutrmail.com/api/email/unsubscribe?t=tok',
    });

    expect(email.subject).toBe('7 new senders are ready for review');
    expect(email.html).toBeUndefined();
    expect(email.text.split('\n').slice(0, 5)).toEqual([
      '7 new senders are ready for review',
      '',
      'They still arrived in Gmail. Screener keeps the decisions together',
      'so you can review the batch when you are ready.',
      '',
    ]);
    expect(email.text).toContain('Review new senders: https://app.declutrmail.com/screener');
    expect(email.text).toContain(
      'Unsubscribe: https://api.declutrmail.com/api/email/unsubscribe?t=tok',
    );
    expect(email.text).toContain('123 Test Street, Test City');
  });
});
