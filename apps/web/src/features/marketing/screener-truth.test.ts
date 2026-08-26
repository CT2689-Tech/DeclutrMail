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

const FORBIDDEN = /\b(block|prevent|intercept|quarantin|keep(s|ing)? out|kept out)/i;

/**
 * Flags a whole passage that mentions the Screener and anywhere attributes
 * a blocking action.
 *
 * NOT sentence-scoped, deliberately. Scoping to the sentence carrying the
 * word "Screener" is just a smaller version of the proximity window that
 * made the old hook rule unworkable, and it fails the same way: prose
 * refers back with pronouns, so "The Screener is on Plus. It blocks new
 * senders." reads clean while asserting exactly the banned claim. It also
 * breaks on any abbreviation, since "e.g." ends a sentence to a splitter.
 *
 * The cost asymmetry here is the opposite of the hook's. This runs in CI,
 * so a false positive fails a build and a human reads one string; a false
 * negative ships a false claim about what the product does to someone's
 * mail. Recall wins. If a legitimate passage ever trips this, add it to
 * ALLOWED below with a note — an explicit, reviewed exception beats a
 * silent miss.
 *
 * Sanctioned phrases are REWRITTEN before matching, never used to exempt
 * the passage that contains them, and the rewrite removes only the
 * forbidden word.
 *
 * Two ways to get this wrong, both of which read as obviously correct:
 *
 *   exempt   — "this passage contains an approved phrase, skip it". One
 *              approved token then licenses every claim beside it.
 *   swallow  — replace the whole phrase with a placeholder. That also
 *              eats the SUBJECT, so "We keep Screener quarantine records.
 *              It blocks new senders." loses its only mention of the
 *              Screener and the claim escapes on a pronoun.
 *
 * The replacement therefore keeps every word that is not the forbidden
 * one — `Screener quarantine records` becomes `Screener SANCTIONED
 * records`, not `SANCTIONED`. A mechanics test below enforces that.
 */
function isOffending(text: string): boolean {
  let neutralised = text.replace(/soft([- ])quarantin\w*/gi, 'soft$1SANCTIONED');
  for (const { pattern, replacement } of SANCTIONED_PHRASES) {
    neutralised = neutralised.replace(pattern, replacement);
  }
  return /screener/i.test(neutralised) && FORBIDDEN.test(neutralised);
}

/**
 * Reviewed exceptions. Each entry needs a comment saying why. Each
 * pattern MUST be global — a non-global regex rewrites only the first
 * occurrence and leaves later ones to be judged as claims — and each
 * replacement MUST preserve any subject word the pattern consumes.
 */
const SANCTIONED_PHRASES: readonly { pattern: RegExp; replacement: string }[] = [
  {
    // The generated inventory (D245) names the DATASET it retains, not
    // what happens to mail — `screener_quarantine` is the table behind
    // it. D228 locks this copy and it is generated from the typed
    // registry, so rewording it is a privacy-disclosure change, not a
    // copy tweak.
    pattern: /Screener quarantine records/gi,
    replacement: 'Screener SANCTIONED records',
  },
];

const SURFACES: ReadonlyArray<readonly [string, unknown]> = [
  ['answers', ANSWER_ARTICLES],
  ['blog', BLOG_ARTICLES],
  ['how-to', HOW_TO_ARTICLES],
  ['changelog', CHANGELOG_ENTRIES],
  ['faq', FAQ_ENTRIES],
  ['comparisons', COMPARISONS],
  // The generated public storage list, rendered by PrivacyBadge on
  // /privacy, /security and the product story.
  ['privacy storage list', PRIVACY_STORAGE_ITEMS],
  // Also generated and also user-facing: onboarding step 2 itemises these
  // labels before the Google consent screen (step-connect.tsx).
  ['derived data inventory', GMAIL_DERIVED_DATA_INVENTORY],
];

describe('D194 — Screener is soft quarantine, never a block', () => {
  // The detector's own blind case. A filter over content that happens to
  // be clean is indistinguishable from a filter that matches nothing, so
  // assert it FIRES before trusting any pass below.
  it('detects a banned framing (guard self-test)', () => {
    expect(isOffending('The Screener blocks new senders.')).toBe(true);
    expect(isOffending('The Screener prevents unwanted email from arriving.')).toBe(true);
    expect(isOffending('New senders are quarantined by the Screener.')).toBe(true);
    expect(isOffending('The Screener keeps out first-time senders.')).toBe(true);
  });

  it('catches a claim that refers back to the Screener across sentences', () => {
    // The paths a sentence-scoped check missed: pronoun subjects, and any
    // abbreviation that a naive splitter reads as a full stop.
    expect(isOffending('The Screener is available on Plus. It blocks new senders.')).toBe(true);
    expect(
      isOffending('New senders go to the Screener. They are prevented from reaching your inbox.'),
    ).toBe(true);
    expect(isOffending('The Screener (e.g. for newsletters) blocks email from arriving.')).toBe(
      true,
    );
    expect(isOffending('Wondering about the Screener? It quarantines everything.')).toBe(true);
  });

  it('allows the sanctioned description', () => {
    expect(isOffending('The Screener is soft quarantine.')).toBe(false);
    expect(isOffending('New senders are collected for review. They still arrive in Gmail.')).toBe(
      false,
    );
    expect(isOffending('Autopilot rules you approve batch by batch.')).toBe(false);
  });

  it('still catches a real claim sitting next to the sanctioned term', () => {
    expect(isOffending('The Screener is a soft-quarantine that blocks email from arriving.')).toBe(
      true,
    );
  });

  it('a sanctioned phrase does not carry the subject away with it', () => {
    // When the approved phrase is the ONLY mention of the Screener, a
    // rewrite that swallowed it would leave a following pronoun claim
    // with nothing to attach to, and the passage would read clean.
    expect(isOffending('We keep Screener quarantine records. It blocks new senders.')).toBe(true);
    expect(
      isOffending('Screener quarantine records exist. They are prevented from arriving.'),
    ).toBe(true);
    expect(isOffending('Screener quarantine records are kept, and delivery is prevented.')).toBe(
      true,
    );
  });

  it('a sanctioned phrase does not license the claims around it', () => {
    // The allowlist neutralises words, it does not excuse passages. An
    // exempting allowlist would pass all three of these.
    expect(
      isOffending(
        'Screener quarantine records are retained. The Screener blocks new senders before they arrive.',
      ),
    ).toBe(true);
    expect(
      isOffending('We store Screener quarantine records, and the Screener prevents delivery.'),
    ).toBe(true);
    expect(
      isOffending('The Screener is soft quarantine, but it also keeps out first-time senders.'),
    ).toBe(true);
  });

  it.each(SURFACES)('%s copy never says the Screener blocks mail', (_name, surface) => {
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

describe('gate mechanics', () => {
  it('every sanctioned phrase is global, so it cannot half-neutralise', () => {
    // A non-global regex replaces only the first occurrence; the second
    // would then be read as a claim, failing a build for approved copy.
    for (const { pattern } of SANCTIONED_PHRASES) {
      expect(pattern.flags, `${pattern} must be global`).toContain('g');
    }
  });

  it('every replacement preserves the subject its pattern consumes', () => {
    // Structural version of the swallow bug: a future entry whose pattern
    // eats "Screener" without putting it back would silently blind the
    // gate to every claim in that passage.
    for (const { pattern, replacement } of SANCTIONED_PHRASES) {
      if (/screener/i.test(pattern.source)) {
        expect(
          replacement,
          `${pattern} consumes the subject; its replacement must keep "Screener"`,
        ).toMatch(/screener/i);
      }
      expect(replacement, `${pattern} must not reintroduce a forbidden word`).not.toMatch(
        FORBIDDEN,
      );
    }
  });

  it('the storage-list exception is load-bearing, not decorative', () => {
    // Without it, the generated list WOULD trip the check — proving the
    // new surface is actually being read rather than silently skipped.
    const label = GMAIL_DERIVED_DATA_INVENTORY.map((item) => item.label).find((item) =>
      /Screener quarantine records/i.test(item),
    );
    expect(label, 'derived inventory no longer names Screener quarantine records').toBeDefined();
    expect(/screener/i.test(label!) && FORBIDDEN.test(label!)).toBe(true);
    expect(isOffending(label!)).toBe(false);
  });
});
