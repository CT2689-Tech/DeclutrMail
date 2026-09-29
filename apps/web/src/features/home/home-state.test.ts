import { describe, expect, it } from 'vitest';

import { composeHomeAction, composeHomeNumbers } from './home-state';

describe('composeHomeNumbers', () => {
  it('totals Archive + Delete emails and leaves Later out of "cleared"', () => {
    const numbers = composeHomeNumbers({
      since: '2026-03-15T12:00:00.000Z',
      decidedSenders: 9,
      emailsByVerb: { keep: 0, archive: 1200, unsubscribe: 0, later: 500, delete: 34 },
    });
    expect(numbers?.hero).toEqual({ label: 'emails cleared', value: 1234 });
    expect(numbers?.secondary).toEqual([
      { label: 'Emails archived', value: 1200 },
      { label: 'Emails deleted', value: 34 },
      { label: 'Senders decided', value: 9 },
    ]);
  });

  it('drops the Archived/Deleted split when one verb is the whole total', () => {
    const numbers = composeHomeNumbers({
      since: null,
      decidedSenders: 2,
      emailsByVerb: { archive: 40, delete: 0 },
    });
    expect(numbers?.hero.value).toBe(40);
    expect(numbers?.secondary).toEqual([{ label: 'Senders decided', value: 2 }]);
  });

  it('falls back to senders decided when no email was cleared', () => {
    const numbers = composeHomeNumbers({
      since: null,
      decidedSenders: 1,
      emailsByVerb: { keep: 0, archive: 0, unsubscribe: 0, later: 12, delete: 0 },
    });
    expect(numbers).toEqual({ hero: { label: 'sender decided', value: 1 }, secondary: [] });
  });

  it('falls back to senders decided when an older API omits emailsByVerb', () => {
    const numbers = composeHomeNumbers({ since: null, decidedSenders: 7 });
    expect(numbers?.hero).toEqual({ label: 'senders decided', value: 7 });
  });

  it('is null — never a zero hero — when nothing was decided', () => {
    expect(
      composeHomeNumbers({ since: null, decidedSenders: 0, emailsByVerb: { archive: 0 } }),
    ).toBeNull();
  });
});

describe('composeHomeAction', () => {
  it('continues Triage first', () => {
    expect(composeHomeAction({ triagePending: 8, screenerPending: 3 })).toEqual({
      label: 'Review 8 today',
      href: '/triage',
    });
  });

  it('then the Screener', () => {
    expect(composeHomeAction({ triagePending: 0, screenerPending: 1 })).toEqual({
      label: 'Review 1 new',
      href: '/screener',
    });
  });

  it('else Senders — including when both reads are locked or failed', () => {
    expect(composeHomeAction({ triagePending: null, screenerPending: null })).toEqual({
      label: 'Review senders',
      href: '/senders',
    });
    expect(composeHomeAction({ triagePending: 0, screenerPending: 0 }).href).toBe('/senders');
  });
});
