// Engagement-truth gate — public copy may not claim a message was OPENED.
//
// Gmail exposes exactly one engagement bit: the absence of the `UNREAD`
// label. There is no open event and there never will be, because open
// tracking needs a pixel from whoever SENT the mail. So "opened" is a
// claim we cannot make, and #566 already replaced it with "marked read"
// everywhere in the product. Two live marketing pages kept it — and one
// of them sat in the paragraph arguing that "sender volume and engagement
// are falsifiable facts", which is the worst possible place for an
// unfalsifiable one.
//
// WHY THE ABSENCE, NOT THE PRESENCE. The pass that introduced "marked
// read" asserted only that the right wording was there. "Opened" survived
// it untouched, in the same corpus, because nothing ever looked for the
// wrong wording. A positive-only test cannot fail on a claim it does not
// mention.
//
// WHY A CLOSED PHRASE LIST, NOT THE BARE TOKEN. Most "open" in this
// corpus is legitimate and load-bearing: "Open in Gmail" is the product's
// own escape hatch, an undo window is open, checkout opened for India.
// Banning the token would fail ~30 true strings to catch four false ones.
// `.claude/hooks/check-microcopy.sh` records the same finding from the
// other direction — its fixed-string rules hold, and its one
// proximity-window rule failed seven review rounds before being replaced
// by a test like this one. So this bans the ENGAGEMENT SENSES, as fixed
// patterns, and self-tests that each one still fires.
//
// NOT COVERED: prose inlined in JSX. `landing/ledger-demo.tsx` carried
// one of the strings this change fixed and this gate cannot see it —
// same boundary `screener-truth.test.ts` names, for the same reason
// (source parsing is what broke the hook). The landing surfaces stay
// with the copy spec's review brief.

import { describe, expect, it } from 'vitest';
import { GMAIL_DERIVED_DATA_INVENTORY, PRIVACY_STORAGE_ITEMS } from '@declutrmail/shared';

import { ANSWER_ARTICLES } from './learn/answer-content';
import { BLOG_ARTICLES } from './learn/blog-content';
import { CHANGELOG_ENTRIES } from './learn/changelog-content';
import { FAQ_ENTRIES } from './learn/faq-content';
import { HOW_TO_ARTICLES } from './learn/how-to-content';
import { COMPARISONS } from './comparison/comparison-data';

/** Every string reachable from a content structure, in order. */
function collectStrings(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') {
    out.push(node);
  } else if (Array.isArray(node)) {
    for (const item of node) collectStrings(item, out);
  } else if (node && typeof node === 'object') {
    for (const value of Object.values(node)) collectStrings(value, out);
  }
  return out;
}

/**
 * The engagement senses of "open", each as a fixed shape.
 *
 * Every entry is a way the product could assert that someone READ a
 * message, as opposed to the many legitimate uses where a person or the
 * app opens something. The comment on each says which real string it was
 * written for, so a future edit can tell a live rule from a speculative
 * one.
 */
const OPEN_AS_ENGAGEMENT: readonly RegExp[] = [
  // "was rarely opened", "opened often", "opened monthly", "Opened
  // regularly", "never opened" — a frequency adverb on either side.
  /\b(rarely|never|seldom|often|regularly|frequently|monthly|weekly|daily|sometimes|occasionally)\s+opened\b/i,
  /\bopened\s+(often|regularly|frequently|monthly|weekly|daily|rarely|never|seldom|sometimes|occasionally)\b/i,
  // "2 opened", "0 opened in 90 days", "17 opened · 8 replies".
  /\b\d+\s*%?\s+opened\b/i,
  // "You open 0% of Groupon's 52/mo." The number is what makes it a
  // metric claim; a bare "you open Gmail" is the escape hatch, not a
  // claim, so the digit is required rather than assumed.
  // ("you almost never opened" is already caught by the adverb rule.)
  /\byou\s+(\w+\s+){0,2}opens?\s+\d/i,
  // "opens" as a metric NOUN in a list of facts: "Volume, subjects,
  // opens, replies"; "Replies and opens can reveal …".
  //
  // The noun and the verb are spelled identically, and the corpus uses
  // the verb constantly ("Brief … opens the relevant message", "the Free
  // tier opens"). Grammar is not available here, so this enumerates the
  // shapes the noun actually takes — inside a comma list, or coordinated
  // with another engagement fact — rather than guessing from the token.
  /\bopens\s*,/i,
  /,\s*opens\b/i,
  /\b(replies|reads?|volume|subjects?|labels?)\s+and\s+opens\b/i,
  /\bopens\s+and\s+(replies|reads?|labels?)\b/i,
  // "open rate", "open tracking", "open count" as a stated capability.
  /\bopen[- ](rate|rates|tracking|count|counts)\b/i,
  // A COUNT of replies, or their absence, presented as an observed fact
  // about a sender. Gmail exposes no causal reply signal — only who a
  // message was addressed to — which is why the product now says "you
  // wrote to them N times". "8 replies" in a demo ledger is the same
  // unfalsifiable claim as "rarely opened", one metric over.
  //
  // The bare word survives: "essential for replies" describes what Gmail
  // is for, and a sender you never wrote back to is a fact we can state.
  // What cannot stand is a number attached to it.
  /\b\d+\s+replies\b/i,
  /\bno replies\b/i,
  /\breceived no replies\b/i,
];

/** The engagement-sense phrases found in a passage, if any. */
function offendingPhrases(text: string): string[] {
  const hits: string[] = [];
  for (const pattern of OPEN_AS_ENGAGEMENT) {
    const match = text.match(pattern);
    if (match) hits.push(match[0]);
  }
  return hits;
}

function isOffending(text: string): boolean {
  return offendingPhrases(text).length > 0;
}

const SURFACES: ReadonlyArray<readonly [string, unknown]> = [
  ['answers', ANSWER_ARTICLES],
  ['blog', BLOG_ARTICLES],
  ['how-to', HOW_TO_ARTICLES],
  ['changelog', CHANGELOG_ENTRIES],
  ['faq', FAQ_ENTRIES],
  ['comparisons', COMPARISONS],
  ['privacy storage list', PRIVACY_STORAGE_ITEMS],
  ['derived data inventory', GMAIL_DERIVED_DATA_INVENTORY],
];

describe('public copy never claims a message was opened', () => {
  // The guard's own blind case. A filter over content that happens to be
  // clean is indistinguishable from a filter that matches nothing, so
  // assert every pattern FIRES before trusting any pass below. These are
  // the exact strings this change removed, plus the shapes next to them.
  it('detects each engagement sense (guard self-test)', () => {
    expect(
      isOffending('The sender arrived often, was rarely opened, and received no replies.'),
    ).toBe(true);
    expect(isOffending('Large inline images · rarely opened')).toBe(true);
    expect(isOffending('12 inbox messages · opened often')).toBe(true);
    expect(isOffending('Wanted announcements · opened monthly')).toBe(true);
    expect(isOffending('Opened regularly · excluded by the observed pattern')).toBe(true);
    expect(isOffending('47 messages · 2 opened · no replies')).toBe(true);
    expect(isOffending('47/mo · 0 opened in 90 days')).toBe(true);
    expect(isOffending("You open 0% of Groupon's 52/mo.")).toBe(true);
    expect(isOffending('Volume spiked 2× while you almost never opened (0% read).')).toBe(true);
    expect(isOffending('Volume, recent subjects, opens, replies, and current labels.')).toBe(true);
    expect(isOffending('Replies and opens can reveal a sender that looks noisy.')).toBe(true);
    expect(isOffending('We measure your open rate over 90 days.')).toBe(true);
    expect(isOffending('DeclutrMail does open tracking.')).toBe(true);
    expect(isOffending('19 messages · 17 marked read · 8 replies')).toBe(true);
    expect(isOffending('47 messages · 2 marked read · no replies')).toBe(true);
    expect(isOffending('arrived often, was rarely marked read, and received no replies')).toBe(
      true,
    );
  });

  it('leaves the legitimate uses of "open" alone', () => {
    // Every one of these is live copy in the corpus below. A rule that
    // fails these is worse than no rule — it would push the next author
    // to delete the product's own escape hatch.
    expect(isOffending('Open the full message in Gmail.')).toBe(false);
    expect(isOffending('Open in Gmail')).toBe(false);
    expect(isOffending('You still open Gmail when you need the full message.')).toBe(false);
    expect(isOffending('Actions stay listed while their undo window is open.')).toBe(false);
    expect(isOffending('DeclutrMail opens a prepared Gmail draft for you to send.')).toBe(false);
    expect(
      isOffending('Checkout opened for India, and health checks learned to notice an outage.'),
    ).toBe(false);
    expect(isOffending('Paid plans open outside India')).toBe(false);
    expect(isOffending('The Free tier opens')).toBe(false);
    expect(
      isOffending('A sender you can name and would never open again belongs in Unsubscribe.'),
    ).toBe(false);
    expect(isOffending('Some senders can be unsubscribed without opening the email.')).toBe(false);
    expect(isOffending('Open a sample')).toBe(false);
    expect(isOffending('Open the sender')).toBe(false);
    // The verb "opens", which the corpus uses far more often than the
    // metric noun this gate is looking for.
    expect(
      isOffending('Brief uses local-time windows and opens the relevant message back in Gmail.'),
    ).toBe(false);
    expect(isOffending('You still open Gmail when you need to read a message.')).toBe(false);
  });

  it('accepts the replacement vocabulary', () => {
    expect(
      isOffending(
        'The sender arrived often, was rarely marked read, and was never written back to.',
      ),
    ).toBe(false);
    expect(isOffending('Volume, recent subjects, read state, and current labels.')).toBe(false);
    expect(isOffending('Marked read regularly · excluded by the observed pattern')).toBe(false);
    expect(isOffending('19 messages · 17 marked read · you wrote back 8×')).toBe(false);
    expect(isOffending('47 messages · 2 marked read · you never wrote back')).toBe(false);
    expect(isOffending('Volume, read rate, whether you write back, and recent subjects.')).toBe(
      false,
    );
    // Still allowed: the word itself, where it is not a count we claim
    // to have measured.
    expect(isOffending('That context is essential for replies and approvals.')).toBe(false);
  });

  it.each(SURFACES)('%s copy never claims a message was opened', (_name, surface) => {
    const offenders = collectStrings(surface).filter(isOffending);
    expect(offenders).toEqual([]);
  });

  it('actually reads a non-trivial amount of copy', () => {
    // Coverage floor: if an import silently becomes empty, the checks
    // above pass while verifying nothing.
    const total = SURFACES.reduce((n, [, surface]) => n + collectStrings(surface).length, 0);
    expect(total).toBeGreaterThan(200);
  });
});
