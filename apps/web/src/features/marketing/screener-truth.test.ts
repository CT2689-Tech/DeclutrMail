// D194 Screener-truth gate — the compensating control for the T3 rule
// that was removed from `.claude/hooks/check-microcopy.sh`.
//
// T3: the Screener is SOFT quarantine. New senders still arrive in the
// Gmail inbox; the Screener only collects them for review. Copy must
// never say it blocks, prevents, keeps out, intercepts or quarantines
// mail (D194 forbidden framings, D72).
//
// WHY A TEST AND NOT THE HOOK. The hook scanned SOURCE, and every one of
// its seven failures came from that: JSX wrapping split phrases, code
// comments read as copy, camelCase identifiers looked like verbs, and
// markup bounded the proximity window. This walks the marketing content
// modules instead, which are plain prose in structured form — no tags,
// no identifiers, no comments — so "is this claim in this sentence"
// becomes tractable. It also runs in CI on every change, which the
// PostToolUse hook never did.
//
// Surfaces NOT covered here (prose inlined in JSX: landing sections, the
// help page, the Screener screen itself) stay with the copy spec's
// review brief, alongside T1, T4 and T7.

import { describe, expect, it } from 'vitest';

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
 * Sentences that mention the Screener AND attribute a blocking action to
 * it. Sentence-scoped on purpose: "The Screener collects new senders.
 * We block nothing." is two claims, and only a single sentence can
 * assert the banned one.
 *
 * "soft quarantine" is the sanctioned description of the mechanism (T3
 * is phrased with it), so it is neutralised before matching rather than
 * filtered afterwards — filtering the whole sentence would let a real
 * claim hide behind the term.
 */
const FORBIDDEN = /\b(block|prevent|intercept|quarantin|keep(s|ing)? out|kept out)/i;

function offendingSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.replace(/soft[- ]quarantin\w*/gi, 'SANCTIONED'))
    .filter((sentence) => /screener/i.test(sentence) && FORBIDDEN.test(sentence));
}

const SURFACES: ReadonlyArray<readonly [string, unknown]> = [
  ['answers', ANSWER_ARTICLES],
  ['blog', BLOG_ARTICLES],
  ['how-to', HOW_TO_ARTICLES],
  ['changelog', CHANGELOG_ENTRIES],
  ['faq', FAQ_ENTRIES],
  ['comparisons', COMPARISONS],
];

describe('D194 — Screener is soft quarantine, never a block', () => {
  // The detector's own blind case. A filter over content that happens to
  // be clean is indistinguishable from a filter that matches nothing, so
  // assert it FIRES before trusting any pass below.
  it('detects a banned framing (guard self-test)', () => {
    expect(offendingSentences('The Screener blocks new senders.')).toHaveLength(1);
    expect(offendingSentences('The Screener prevents unwanted mail from arriving.')).toHaveLength(
      1,
    );
    expect(offendingSentences('New senders are quarantined by the Screener.')).toHaveLength(1);
    expect(offendingSentences('The Screener keeps out first-time senders.')).toHaveLength(1);
  });

  it('allows the sanctioned description and unrelated neighbouring claims', () => {
    expect(offendingSentences('The Screener is soft quarantine.')).toHaveLength(0);
    expect(
      offendingSentences(
        'The Screener collects new senders. We block nothing; mail still arrives.',
      ),
    ).toHaveLength(0);
    expect(
      offendingSentences('New senders are collected for review. They still arrive in Gmail.'),
    ).toHaveLength(0);
  });

  it('still catches a real claim sitting next to the sanctioned term', () => {
    expect(
      offendingSentences('The Screener is a soft-quarantine that blocks mail from arriving.'),
    ).toHaveLength(1);
  });

  it.each(SURFACES)('%s copy never says the Screener blocks mail', (_name, surface) => {
    const offenders = collectStrings(surface).flatMap(offendingSentences);
    expect(offenders).toEqual([]);
  });

  it('actually reads a non-trivial amount of copy', () => {
    // Coverage floor: if an import silently becomes empty, the checks
    // above pass while verifying nothing.
    const total = SURFACES.reduce((n, [, surface]) => n + collectStrings(surface).length, 0);
    expect(total).toBeGreaterThan(200);
  });
});
