import { describe, expect, it } from 'vitest';

import {
  describeInboxScope,
  inboxScopeNoticeCopy,
  mailLocationCopy,
  tiedWindowNoticeCopy,
} from './inbox-scope';

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
      'Nothing from this sender is in your inbox right now — though 71 arrived in the last 90 days. Delete only acts on email still in the inbox.',
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
      'Nothing from this sender is in your inbox right now — though 8 arrived in the last 90 days. Delete acts on inbox email by default.',
    );
    // Surfaces without a reach control (Screener) keep the absolute
    // wording, which is true there.
    expect(
      inboxScopeNoticeCopy({ kind: 'empty-inbox', recentArrivals: 8 }, 'Delete', 'this sender', {}),
    ).toContain('Delete only acts on email still in the inbox.');
  });

  it('omits the arrivals clause when there are none to name', () => {
    expect(inboxScopeNoticeCopy({ kind: 'empty-inbox', recentArrivals: 0 }, 'Archive')).toBe(
      'Nothing from this sender is in your inbox right now. Archive only acts on email still in the inbox.',
    );
    expect(inboxScopeNoticeCopy({ kind: 'empty-inbox', recentArrivals: null }, 'Archive')).toBe(
      'Nothing from this sender is in your inbox right now. Archive only acts on email still in the inbox.',
    );
  });

  it('points an empty window at the wider one that would match', () => {
    expect(
      inboxScopeNoticeCopy({ kind: 'empty-window', inboxTotal: 30, olderThanDays: 180 }, 'Delete'),
    ).toBe(
      '30 emails from this sender are in your inbox, but none are older than the 6 months+ window. Widen the window to include them.',
    );
  });

  // QA-delete-20260829-03 — the notice must name the SAME unit the window
  // chip itself is labelled in (a day count next to a "6 months+" chip is a
  // unit mismatch), for every preset the window control actually offers.
  it.each([
    [30, '30 days+'],
    [90, '3 months+'],
    [180, '6 months+'],
    [365, '1 year+'],
  ])('names the %s-day preset as "%s", not a day count', (days, label) => {
    const copy = inboxScopeNoticeCopy(
      { kind: 'empty-window', inboxTotal: 1, olderThanDays: days },
      'Delete',
    );
    expect(copy).toContain(`the ${label} window`);
    expect(copy).not.toMatch(/\d+ days?\.?\s*Widen/);
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
      'Nothing from these senders is in your inbox right now. Archive only acts on email still in the inbox.',
    );
    expect(
      inboxScopeNoticeCopy(
        { kind: 'empty-window', inboxTotal: 30, olderThanDays: 180 },
        'Archive',
        'these senders',
      ),
    ).toBe(
      '30 emails from these senders are in your inbox, but none are older than the 6 months+ window. Widen the window to include them.',
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
      'Nothing from this sender is in your inbox right now — though 1 arrived in the last 90 days. Delete only acts on email still in the inbox.',
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
      'Nothing newer than 182 days, so every window through 6 months+ matches the same 2,908.',
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
      'This sender has nothing newer, so every window through 6 months+ matches the same 2,908.',
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
    ).toBe('Nothing newer than 33 days, so every window through 30 days+ matches the same 1,707.');
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
    expect(tiedWindowNoticeCopy(counts, 5269)).toContain('5,269 days');
    expect(tiedWindowNoticeCopy(counts, 0)).toContain('0 days');
  });
});

// Founder report 2026-08-25: a Later preview on `ealerts.bankofamerica.com`
// read "0 emails currently match" beside a strip reading "200 in last 90d ·
// 6,668 received". The numbers were all correct and the founder still had to
// open Gmail to find out the mail was sitting under a label.
describe('mailLocationCopy', () => {
  it("partitions the sender's mail into segments that sum to the received figure", () => {
    // The prod shape: header reads "6,668 received", inbox reads 0, and
    // the two never reconciled on screen.
    expect(mailLocationCopy({ inboxNow: 0, allMailNow: 6275, receivedTotal: 6668 })).toBe(
      "Where this sender's mail is now: 0 emails in your inbox \u00b7 6,275 emails elsewhere in Gmail " +
        '(archived or under a label) \u00b7 393 emails in Trash or Spam.',
    );
  });

  // QA-delete-20260829-09 \u2014 "this email" is false for a population, and
  // the inbox segment needs the same unit noun every other segment gets.
  it('gives the inbox segment its own unit noun and a population-scoped opener', () => {
    const copy = mailLocationCopy({ inboxNow: 1718, allMailNow: 1874, receivedTotal: 1874 })!;
    expect(copy.startsWith("Where this sender's mail is now:")).toBe(true);
    expect(copy).toContain('1,718 emails in your inbox');
  });

  it('subtracts the inbox out of the all-mail superset rather than double-counting', () => {
    // `all_mail` INCLUDES inbox mail, so a naive render would claim
    // 12 + 6,275 = 6,287 messages exist when there are 6,275.
    expect(mailLocationCopy({ inboxNow: 12, allMailNow: 6275, receivedTotal: 6275 })).toContain(
      '6,263 emails elsewhere',
    );
  });

  it('omits the Trash segment when there is no gap to explain', () => {
    // Observed on the dev mailbox: received === all-mail, so a
    // "0 in Trash or Spam" segment would be noise, and a sentence about
    // what "received" includes would explain a gap the reader cannot see.
    const copy = mailLocationCopy({ inboxNow: 0, allMailNow: 6668, receivedTotal: 6668 })!;
    expect(copy).toContain('6,668 emails elsewhere in Gmail');
    expect(copy).not.toContain('Trash or Spam');
  });

  it('omits the Trash segment when the caller has no received figure', () => {
    expect(mailLocationCopy({ inboxNow: 0, allMailNow: 71, receivedTotal: null })).not.toContain(
      'Trash',
    );
  });

  // QA-senders-20260901-06: a lone part reconciles nothing — it restates
  // the headline count already on screen. Say nothing instead.
  it('stays silent when the inbox holds everything (nothing to reconcile)', () => {
    expect(mailLocationCopy({ inboxNow: 9, allMailNow: 9, receivedTotal: 9 })).toBeNull();
  });

  it('never claims anyone archived the mail — only that it is not in the inbox', () => {
    // `mail_messages` stores CURRENT labels and no history, so a
    // "you archived these" reading is unprovable. A Gmail filter with
    // "Skip the Inbox" produces this exact shape with no transition.
    const copy = mailLocationCopy({ inboxNow: 0, allMailNow: 71, receivedTotal: 71 })!;
    expect(copy).not.toMatch(/you (archived|deleted|moved)/i);
    expect(copy).toContain('archived or under a label');
  });

  it('stays silent until BOTH reaches resolve, and against an API with no all-mail block', () => {
    expect(
      mailLocationCopy({ inboxNow: undefined, allMailNow: 6275, receivedTotal: 6668 }),
    ).toBeNull();
    expect(
      mailLocationCopy({ inboxNow: 0, allMailNow: undefined, receivedTotal: 6668 }),
    ).toBeNull();
  });

  it('stays silent when the mailbox holds nothing for the sender', () => {
    expect(mailLocationCopy({ inboxNow: 0, allMailNow: 0, receivedTotal: 0 })).toBeNull();
  });

  it('clamps rather than rendering a negative segment', () => {
    // Counter drift is bounded and reconciled nightly, but a nonsense
    // number rendered confidently is the failure mode this file exists
    // to prevent — degrade to omission, never to "-5 in Trash". Clamping
    // collapses this to a single part, which is now silence rather than
    // a sentence (QA-senders-20260901-06) — still never a negative.
    expect(mailLocationCopy({ inboxNow: 9, allMailNow: 4, receivedTotal: 1 })).toBeNull();
  });

  it('singularizes one message', () => {
    expect(mailLocationCopy({ inboxNow: 0, allMailNow: 1, receivedTotal: 1 })).toContain(
      '1 email elsewhere',
    );
  });

  // Codex round 1 (QA-delete-20260829-09) — the Trash/Spam segment was
  // missed in the first pass: only the inbox segment got a unit noun.
  it('gives the Trash/Spam segment its own unit noun too', () => {
    const copy = mailLocationCopy({ inboxNow: 0, allMailNow: 1, receivedTotal: 2 })!;
    expect(copy).toContain('1 email in Trash or Spam');
  });
});
