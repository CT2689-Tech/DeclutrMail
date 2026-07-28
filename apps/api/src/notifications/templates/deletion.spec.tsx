import { describe, expect, it } from 'vitest';

import { deletionReceiptEmail } from './deletion-receipt.js';
import { deletionScheduledEmail } from './deletion-scheduled.js';

describe('deletion emails', () => {
  it('scheduled carries the cancel url and the non-opt-out notice', async () => {
    const email = await deletionScheduledEmail({
      scheduledFor: 'June 18, 2026',
      cancelUrl: 'https://app.declutrmail.com/account/cancel-deletion?t=tok',
    });
    expect(email.subject).toBe('Your DeclutrMail deletion is scheduled');
    expect(email.text).toContain('June 18, 2026');
    expect(email.text).toContain('https://app.declutrmail.com/account/cancel-deletion?t=tok');
    expect(email.text).toContain('This is a required account notice; it cannot be turned off.');
    expect(email.html).toContain('cancel-deletion');
  });

  it('receipt states Gmail itself was untouched', async () => {
    const email = await deletionReceiptEmail({ deletedAt: 'June 18, 2026' });
    expect(email.subject).toBe('Your DeclutrMail data has been deleted');
    expect(email.text).toContain('Your Gmail account itself was never modified');
    expect(email.html).toContain('never modified');
  });
});
