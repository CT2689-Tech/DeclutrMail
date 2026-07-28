import { describe, expect, it } from 'vitest';

import { describeInboxScope, inboxScopeNoticeCopy, tiedWindowNoticeCopy } from './inbox-scope';

describe('describeInboxScope', () => {
  it('stays silent when the selected window actually matches mail', () => {
    expect(
      describeInboxScope({
        inboxTotal: 250,
        windowCount: 12,
        olderThanDays: 365,
        recentArrivals: 40,
      }),
    ).toEqual({ kind: 'none' });
  });

  it('stays silent while the live preview has not resolved', () => {
    expect(
      describeInboxScope({
        inboxTotal: undefined,
        windowCount: undefined,
        olderThanDays: 180,
        recentArrivals: 71,
      }),
    ).toEqual({ kind: 'none' });
  });

  // The reported bug: 71/mo above five all-zero window chips. Both
  // numbers are true — every recent arrival is already archived — so the
  // preview has to reconcile them instead of showing a bare 0.
  it('reconciles a busy sender whose mail is entirely out of the inbox', () => {
    expect(
      describeInboxScope({
        inboxTotal: 0,
        windowCount: 0,
        olderThanDays: 180,
        recentArrivals: 71,
      }),
    ).toEqual({ kind: 'empty-inbox', recentArrivals: 71 });
  });

  it('reports an empty inbox without inventing an arrival count', () => {
    expect(
      describeInboxScope({
        inboxTotal: 0,
        windowCount: 0,
        olderThanDays: null,
        recentArrivals: 0,
      }),
    ).toEqual({ kind: 'empty-inbox', recentArrivals: 0 });

    expect(
      describeInboxScope({
        inboxTotal: 0,
        windowCount: 0,
        olderThanDays: null,
        recentArrivals: null,
      }),
    ).toEqual({ kind: 'empty-inbox', recentArrivals: null });
  });

  // The actionable half: the inbox is not empty, this window just
  // excludes all of it. Widening the window is a real next step, and
  // "empty inbox" copy would be a lie here.
  it('distinguishes an empty window from an empty inbox', () => {
    expect(
      describeInboxScope({
        inboxTotal: 30,
        windowCount: 0,
        olderThanDays: 180,
        recentArrivals: 30,
      }),
    ).toEqual({ kind: 'empty-window', inboxTotal: 30, olderThanDays: 180 });
  });

  it('cannot report an empty window when no window is selected', () => {
    // windowCount === inboxTotal when olderThanDays is null, so a 0 here
    // is an empty inbox by definition — never a narrow-window story.
    expect(
      describeInboxScope({
        inboxTotal: 0,
        windowCount: 0,
        olderThanDays: null,
        recentArrivals: 5,
      }),
    ).toEqual({ kind: 'empty-inbox', recentArrivals: 5 });
  });
});

describe('inboxScopeNoticeCopy', () => {
  // States the two observed facts, never a transition between them:
  // `mail_messages` has no label history, so "moved out of your inbox" /
  // "you archived these" cannot be known. A Gmail "Skip the Inbox" filter
  // produces this exact shape with nothing ever entering the inbox.
  it('names the arrivals and the verb scope without claiming any history', () => {
    const copy = inboxScopeNoticeCopy({ kind: 'empty-inbox', recentArrivals: 71 }, 'Delete');
    expect(copy).toBe(
      'Nothing from this sender is in your inbox right now — though 71 arrived in the last 30 days. Delete only acts on mail still in the inbox.',
    );
    expect(copy).not.toMatch(/moved out|archived|deleted|no longer|used to|were in/i);
  });

  // ADR-0028 — a surface with a reach control must not claim the verb
  // "only acts on" inbox mail while offering the chip that widens it.
  it('softens the scope tail to "by default" when the verb can act beyond the inbox', () => {
    expect(
      inboxScopeNoticeCopy({ kind: 'empty-inbox', recentArrivals: 8 }, 'Delete', 'this sender', {
        verbActsBeyondInbox: true,
      }),
    ).toBe(
      'Nothing from this sender is in your inbox right now — though 8 arrived in the last 30 days. Delete acts on inbox mail by default.',
    );
    // Surfaces without a reach control (Screener) keep the absolute
    // wording, which is true there.
    expect(
      inboxScopeNoticeCopy({ kind: 'empty-inbox', recentArrivals: 8 }, 'Delete', 'this sender', {}),
    ).toContain('Delete only acts on mail still in the inbox.');
  });

  it('omits the arrivals clause when there are none to name', () => {
    expect(inboxScopeNoticeCopy({ kind: 'empty-inbox', recentArrivals: 0 }, 'Archive')).toBe(
      'Nothing from this sender is in your inbox right now. Archive only acts on mail still in the inbox.',
    );
    expect(inboxScopeNoticeCopy({ kind: 'empty-inbox', recentArrivals: null }, 'Archive')).toBe(
      'Nothing from this sender is in your inbox right now. Archive only acts on mail still in the inbox.',
    );
  });

  it('points an empty window at the wider one that would match', () => {
    expect(
      inboxScopeNoticeCopy({ kind: 'empty-window', inboxTotal: 30, olderThanDays: 180 }, 'Delete'),
    ).toBe(
      '30 emails from this sender are in your inbox, but none are older than 180 days. Widen the window to include them.',
    );
  });

  // A bulk sheet covering twelve senders must not say "this sender".
  it('pluralizes for a bulk request', () => {
    expect(
      inboxScopeNoticeCopy(
        { kind: 'empty-inbox', recentArrivals: null },
        'Archive',
        'these senders',
      ),
    ).toBe(
      'Nothing from these senders is in your inbox right now. Archive only acts on mail still in the inbox.',
    );
    expect(
      inboxScopeNoticeCopy(
        { kind: 'empty-window', inboxTotal: 30, olderThanDays: 180 },
        'Archive',
        'these senders',
      ),
    ).toBe(
      '30 emails from these senders are in your inbox, but none are older than 180 days. Widen the window to include them.',
    );
  });

  it('renders nothing for the silent case', () => {
    expect(inboxScopeNoticeCopy({ kind: 'none' }, 'Delete')).toBeNull();
  });

  it('keeps singulars readable', () => {
    expect(
      inboxScopeNoticeCopy({ kind: 'empty-window', inboxTotal: 1, olderThanDays: 1 }, 'Archive'),
    ).toBe(
      '1 email from this sender is in your inbox, but it is not older than 1 day. Widen the window to include it.',
    );
    // Singular needs no special casing now that the clause is a bare
    // statement of fact rather than a verb phrase about the mail's fate.
    expect(inboxScopeNoticeCopy({ kind: 'empty-inbox', recentArrivals: 1 }, 'Delete')).toBe(
      'Nothing from this sender is in your inbox right now — though 1 arrived in the last 30 days. Delete only acts on mail still in the inbox.',
    );
  });
});

describe('tiedWindowNoticeCopy', () => {
  // github.com, 2026-07-27: newest inbox message is 182 days old, so
  // All/30d/90d/180d all match 2,908 and only 1yr+ narrows. Four
  // identical chips read as a broken control.
  const github = [
    { label: 'All inbox', count: 2908 },
    { label: '30 days+', count: 2908 },
    { label: '3 months+', count: 2908 },
    { label: '6 months+', count: 2908 },
    { label: '1 year+', count: 59 },
  ];

  it('explains a run of tied windows and names the widest one', () => {
    expect(tiedWindowNoticeCopy(github, 182)).toBe(
      "Every window through 6 months+ matches the same 2,908 — this sender's newest inbox email is 182 days old, so those windows exclude nothing.",
    );
  });

  it('stays silent when every step narrows something', () => {
    expect(
      tiedWindowNoticeCopy(
        [
          { label: 'All inbox', count: 26 },
          { label: '30 days+', count: 24 },
          { label: '3 months+', count: 16 },
          { label: '6 months+', count: 9 },
          { label: '1 year+', count: 0 },
        ],
        3,
      ),
    ).toBeNull();
  });

  it('stays silent on an all-zero row — the empty-inbox notice owns that', () => {
    expect(
      tiedWindowNoticeCopy(
        [
          { label: 'All inbox', count: 0 },
          { label: '30 days+', count: 0 },
        ],
        null,
      ),
    ).toBeNull();
  });

  it('stays silent while counts are unresolved', () => {
    expect(
      tiedWindowNoticeCopy(
        [
          { label: 'All inbox', count: undefined },
          { label: '30 days+', count: undefined },
        ],
        182,
      ),
    ).toBeNull();
  });

  it('omits the age clause rather than inventing one', () => {
    expect(tiedWindowNoticeCopy(github, null)).toBe(
      'Every window through 6 months+ matches the same 2,908 — this sender has nothing newer, so those windows exclude nothing.',
    );
  });

  // etherscan.io: only All inbox and 30 days+ tie (1,707), the rest narrow.
  it('handles a partial tie at the top', () => {
    expect(
      tiedWindowNoticeCopy(
        [
          { label: 'All inbox', count: 1707 },
          { label: '30 days+', count: 1707 },
          { label: '3 months+', count: 1654 },
          { label: '6 months+', count: 1650 },
          { label: '1 year+', count: 1648 },
        ],
        33,
      ),
    ).toBe(
      "Every window through 30 days+ matches the same 1,707 — this sender's newest inbox email is 33 days old, so those windows exclude nothing.",
    );
  });
});

// Regression: B derived its age from `sender.lastSeenDays`, which is
// all-labels. Measured on the dev mailbox 2026-07-27, linkedin.com would
// have printed "0 days old" for an inbox whose newest message was 5,269
// days old. The classifier itself must faithfully render whatever age it
// is handed — the CALLER now supplies an inbox-scoped one.
describe('tiedWindowNoticeCopy — age is caller-supplied, never inferred', () => {
  it('prints exactly the age it is given', () => {
    const counts = [
      { label: 'All inbox', count: 4 },
      { label: '30 days+', count: 4 },
      { label: '3 months+', count: 1 },
    ];
    expect(tiedWindowNoticeCopy(counts, 5269)).toContain('5,269 days old');
    expect(tiedWindowNoticeCopy(counts, 0)).toContain('0 days old');
  });
});
