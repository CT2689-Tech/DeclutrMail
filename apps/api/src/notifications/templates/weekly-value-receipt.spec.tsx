import type { WeeklyValueReceiptFacts } from '@declutrmail/workers';
import { describe, expect, it, vi } from 'vitest';

import { weeklyValueReceiptEmail } from './weekly-value-receipt.js';

vi.mock('@declutrmail/shared/copy', () => ({
  postalAddressLine: () => '123 Test Street, Test City',
}));

const FACTS: WeeklyValueReceiptFacts = {
  automatedMessages: 184,
  ownDecisions: 23,
  briefSurfaced: 6,
  pendingScreener: 12,
  undone: 2,
};

function render(facts: Partial<WeeklyValueReceiptFacts> = {}) {
  return weeklyValueReceiptEmail({
    facts: { ...FACTS, ...facts },
    appUrl: 'https://app.declutrmail.com',
    unsubscribeUrl: 'https://api.declutrmail.com/api/email/unsubscribe?t=tok',
  });
}

describe('weekly-value-receipt', () => {
  it('reports the week as recorded facts, in compliant plain text', () => {
    const email = render();

    expect(email.subject).toBe('Your week with DeclutrMail');
    // D189/D126 lock the receipt to plain text — no marketing chrome.
    expect(email.html).toBeUndefined();
    expect(email.text.split('\n').slice(0, 8)).toEqual([
      'This week DeclutrMail:',
      '- 184 messages kept out of your inbox by rules you turned on',
      '- 23 senders you decided on yourself',
      '- 6 senders surfaced in your Brief as worth reading',
      '- 2 actions you undid',
      '',
      // Current state, kept OUT of the "this week" list on purpose.
      '12 new senders are waiting in Screener right now.',
      '',
    ]);
    // D189's load-bearing trust line, stated as the checkable guarantee
    // it is: Delete adds Gmail's TRASH label and nothing calls Gmail's
    // permanent messages.delete.
    expect(email.text).toContain('Nothing was deleted permanently.');
    expect(email.text).toContain(
      'Unsubscribe: https://api.declutrmail.com/api/email/unsubscribe?t=tok',
    );
    expect(email.text).toContain('123 Test Street, Test City');
  });

  /**
   * The unknown-vs-zero rule. `briefSurfaced: null` means the Brief did
   * not run; rendering "0 senders surfaced in your Brief" would assert a
   * measurement that never happened.
   */
  it('omits a line rather than printing a number it did not measure', () => {
    const email = render({ briefSurfaced: null, undone: 0, automatedMessages: 0 });

    expect(email.text).not.toContain('Brief');
    expect(email.text).not.toContain('you undid');
    expect(email.text).not.toContain('kept out of your inbox');
    // What DID happen still gets said.
    expect(email.text).toContain('- 23 senders you decided on yourself');
    // And no line anywhere claims a zero.
    expect(email.text).not.toContain('- 0 ');
  });

  it('drops the weekly heading when only the current backlog is left to report', () => {
    const email = render({
      automatedMessages: 0,
      ownDecisions: 0,
      briefSurfaced: null,
      undone: 0,
      pendingScreener: 12,
    });

    // No bullets means nothing happened this week; a "This week
    // DeclutrMail:" header over an empty list would imply otherwise.
    expect(email.text).not.toContain('This week DeclutrMail:');
    expect(email.text.split('\n')[0]).toBe('12 new senders are waiting in Screener right now.');
  });

  it('never states a projected figure — no minutes-saved estimate', () => {
    // D189 specified `(decisions × 30s) + (actions × 5s)`. Those
    // coefficients were never measured, so the product is a guess and
    // the receipt does not carry it.
    expect(render().text).not.toMatch(/minutes|saved/i);
  });

  it('singularises counts', () => {
    const email = render({
      automatedMessages: 1,
      ownDecisions: 1,
      briefSurfaced: 1,
      undone: 1,
      pendingScreener: 1,
    });

    expect(email.text).toContain('- 1 message kept out of your inbox');
    expect(email.text).toContain('- 1 sender you decided on yourself');
    expect(email.text).toContain('- 1 action you undid');
    expect(email.text).toContain('1 new sender is waiting in Screener right now.');
  });
});
