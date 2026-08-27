// Tier-truth gate — marketing prose may not name a plan as gating a
// feature the manifest does not gate that way.
//
// WHY THIS EXISTS. The ladder is config: `TIER_MANIFEST` drives every
// gate, the pricing table, the card bullets, the 402 upgrade copy and
// the crawler feed. Prose is the one surface that cannot derive. When
// `autopilot-active` and `quiet` moved to Plus (2026-08-23), three
// hand-written passages kept saying "only on Pro" — each individually
// plausible, none reachable from a type error. This test is the
// compensating control: it reads the same content modules the
// Screener-truth gate reads (plain prose in structured form — no JSX,
// no identifiers, no comments) and fails when a passage attributes a
// feature to the wrong plan.
//
// Surfaces NOT covered: prose inlined in JSX (landing sections, help,
// feature screens). Those stay with the copy spec's review brief, same
// boundary the Screener-truth gate draws.
//
// BLIND-CASE FIRST. A scanner over an empty corpus passes every
// assertion while proving nothing — this repo has shipped that exact
// defect (a guard reporting ✓ having verified zero rows). So the corpus
// size and the number of feature mentions actually inspected are both
// asserted before any claim is checked. Starve the input and this file
// goes red, which is the whole point.

import { describe, expect, it } from 'vitest';
import {
  minimumTierForCapability,
  TIER_IDS,
  TIER_MANIFEST,
  hasCapability,
  type Capability,
  type TierId,
} from '@declutrmail/shared/entitlements';

import { ACTION_SAFETY_SUMMARY } from '@declutrmail/shared/copy';

import { TIER_JOBS } from './pricing/pricing-model';
import { MARKETING_CONTENT_CORPUS } from './content-registry';

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
 * The corpus. `changelog-content` is deliberately NOT imported: a changelog
 * records what was true on a date, so "Autopilot now exposes its Pro
 * plan gates" stays accurate as history even after the gate moves.
 * Rewriting it would be falsifying a dated record. Every other module
 * describes the product in the present tense.
 */
const CORPUS: readonly string[] = [
  // Exported product-truth strings, not just the article modules. Added
  // 2026-08-23 after `ACTION_SAFETY_SUMMARY` shipped "On Plus, Autopilot
  // finds matches and waits for your approval. On Pro, rules you turn on
  // can handle future matches automatically" for a day after both
  // behaviours moved to Plus — a false sentence on the pricing page that
  // this file, scoped to the learn/comparison modules, could not see.
  ACTION_SAFETY_SUMMARY,
  ...Object.values(TIER_JOBS),
  // Content modules come from the shared registry (2026-08-27). Naming
  // them by hand here — and again in `screener-truth` and
  // `engagement-truth` — meant a new module was scanned by none of the
  // three, with each gate's coverage floor sized to the corpus that
  // already existed, so nothing could detect the gap. Exactly the
  // blind-guard shape this file's own header warns about.
  ...MARKETING_CONTENT_CORPUS.flatMap((collection) => collectStrings(collection)),
];

/**
 * The user-facing noun for each gated capability. Only capabilities a
 * reader could plausibly be told the price of — the Free read surfaces
 * carry no gating claim to get wrong.
 *
 * A total-ish record on purpose: adding a gated capability without a
 * noun here silently drops it from the scan, so the list is asserted
 * against the manifest below rather than trusted.
 */
const FEATURE_NOUNS: Partial<Record<Capability, RegExp>> = {
  screener: /\bScreener\b/i,
  autopilot: /\bAutopilot\b/i,
  'autopilot-active': /\bAutopilot\b/i,
  brief: /\b(Daily Brief|the Brief)\b/i,
  quiet: /\bQuiet hours\b/i,
  followups: /\bFollow-?ups\b/i,
};

/**
 * Marketing prose spells numbers out. Every rule below matches digits,
 * so "a seven-day Undo window" and "Pro supports up to three inboxes"
 * were invisible while being exactly the sentences that went false.
 * Normalise before matching — the corpus is human copy, not data.
 */
const NUMBER_WORDS: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  fourteen: 14,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  sixty: 60,
  ninety: 90,
};

function normalizeNumbers(text: string): string {
  return text.replace(new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join('|')})\\b`, 'gi'), (word) =>
    String(NUMBER_WORDS[word.toLowerCase()] ?? word),
  );
}

/**
 * Words that turn a plan mention into a CLAIM about entitlement.
 *
 * Widened 2026-08-23. The original list was all prepositional
 * ("only", "part of", "available on"), and the corpus mostly writes in
 * the copular/declarative voice instead: "acting without per-batch
 * approval **is** Pro", "Pro **supports up to** three inboxes", "Plus
 * and Pro **include** five preset rules". Six false passages sat inside
 * the corpus while this gate reported clean.
 */
const GATING =
  /\b(only|requires?|part of|upgrade|available (on|in|with)|includes?|included (in|with)|exclusive|supports?|offers?|adds?|gets?|comes with|unlocks?)\b/i;

/**
 * EXCLUSIVITY claims — "only on Pro", "requires Pro", "Pro-only".
 *
 * A separate rule from the one below, and the more important of the
 * two, because the failure it catches is invisible to a "does this plan
 * grant it?" check. When `autopilot-active` moved from Pro to Plus, the
 * FAQ still read "only on Pro can a rule be switched to act on future
 * matches". Pro DOES grant it — the false part is the exclusivity, i.e.
 * the implied claim that Plus does not. Checking grant-ness alone reads
 * that sentence as clean, which is exactly what the first version of
 * this file did.
 *
 * So exclusivity is checked against the LOWEST granting plan, not
 * against grant-ness: if a passage says a feature is only on X, X must
 * be the cheapest plan that has it.
 */
const EXCLUSIVE_CLAIM = new RegExp(
  String.raw`\b(?:only\s+(?:on|in|with|available\s+(?:on|in))?\s*|requires?\s+(?:a\s+)?|upgrade\s+to\s+)` +
    `(${TIER_IDS.map((id) => TIER_MANIFEST[id].name).join('|')})\\b` +
    String.raw`|\b(${TIER_IDS.map((id) => TIER_MANIFEST[id].name).join('|')})[-\s]only\b`,
  'gi',
);

/** Tier ids named as EXCLUSIVE in a passage, in order of appearance. */
function exclusiveTiersIn(text: string): readonly TierId[] {
  const names = new Map(TIER_IDS.map((id) => [TIER_MANIFEST[id].name.toLowerCase(), id]));
  const out: TierId[] = [];
  for (const match of text.matchAll(EXCLUSIVE_CLAIM)) {
    const name = (match[1] ?? match[2] ?? '').toLowerCase();
    const tier = names.get(name);
    if (tier && !out.includes(tier)) out.push(tier);
  }
  return out;
}

const TIER_NAME_PATTERNS: ReadonlyArray<{ tier: TierId; pattern: RegExp }> = TIER_IDS.map(
  (tier) => ({ tier, pattern: new RegExp(`\\b${TIER_MANIFEST[tier].name}\\b`) }),
);

interface Mention {
  readonly capability: Capability;
  readonly tier: TierId;
  readonly text: string;
}

/**
 * Passages that mention a gated feature, a plan name, and a gating
 * word. Passage-scoped, not sentence-scoped, for the same reason the
 * Screener-truth gate is: prose refers back with pronouns, so
 * sentence-scoping reads "Quiet hours schedule automation. It is only
 * on Pro." as clean.
 */
function gatingMentions(corpus: readonly string[] = CORPUS): readonly Mention[] {
  const out: Mention[] = [];
  for (const text of corpus) {
    if (!GATING.test(text)) continue;

    // SINGLE-tier passages only. Attribution needs an unambiguous
    // subject: "Plus adds the Screener" is a claim about Plus. A
    // comparison passage that walks all three plans — "Free supports one
    // inbox … Plus adds the Screener … Pro adds Follow-ups" — names
    // every tier beside every feature, so passage-scoping would read it
    // as attributing Follow-ups to Free. That is the reader's error, not
    // the copy's. Multi-tier passages are covered by the exclusivity and
    // contrast rules below, which reason about the RELATION between the
    // plans rather than pairing each name with each feature.
    const tiers = TIER_NAME_PATTERNS.filter(({ pattern }) => pattern.test(text));
    if (tiers.length !== 1) continue;
    const tier = tiers[0]!.tier;

    for (const [capability, noun] of Object.entries(FEATURE_NOUNS) as Array<[Capability, RegExp]>) {
      if (noun.test(text)) out.push({ capability, tier, text });
    }
  }
  return out;
}

describe('tier-truth gate — prose may not misprice a feature', () => {
  // ── Blind-case guards. These run first and on purpose. ──

  it('actually reads a corpus', () => {
    expect(CORPUS.length).toBeGreaterThan(100);
    expect(CORPUS.every((s) => typeof s === 'string')).toBe(true);
  });

  it('has a noun for every capability a reader could be quoted a price for', () => {
    // Any capability NOT granted at the bottom of the ladder is gated,
    // and therefore claimable in prose. Derived, so a new gated
    // capability fails here instead of slipping past the scan unseen.
    const lowest = TIER_IDS[0]!;
    const gated = TIER_IDS.flatMap((id) => TIER_MANIFEST[id].capabilities).filter(
      (cap, i, all) => all.indexOf(cap) === i && !hasCapability(lowest, cap),
    );
    for (const cap of gated) {
      expect(FEATURE_NOUNS[cap], `no marketing noun registered for "${cap}"`).toBeDefined();
    }
  });

  it('attributes a single-tier claim correctly (mechanics)', () => {
    // COVERAGE NOTE, stated rather than hidden. This assertion used to
    // read `expect(gatingMentions().length).toBeGreaterThan(0)` on the
    // real corpus. Once the attribution rule was correctly narrowed to
    // SINGLE-tier passages, that count went to zero: every gating
    // passage in the corpus today names two or more plans, so the
    // attribution rule currently inspects NOTHING.
    //
    // It is kept as a tripwire for NEW copy — "Quiet hours is part of
    // the Pro plan" is exactly its case, and that sentence is one
    // careless edit away. But a "found something" assertion over an
    // empty set would be the blind guard this file exists to avoid, so
    // the matcher is pinned against fixtures instead, and the live
    // corpus is left to the exclusivity, contrast, undo and inbox rules
    // that do have input.
    const wrong = gatingMentions(['Quiet hours is part of the Pro plan.']);
    expect(wrong.map((m) => m.capability)).toContain('quiet');

    // Multi-tier prose is deliberately skipped — that is the
    // exclusivity and contrast rules' job, not this one's.
    expect(gatingMentions(['Plus adds the Screener; Pro adds Follow-ups.'])).toEqual([]);
  });

  // ── The claim itself. ──

  it('never names a plan that does not grant the feature', () => {
    const wrong = gatingMentions().filter(
      ({ capability, tier }) => !hasCapability(tier, capability),
    );
    expect(
      wrong.map(
        ({ capability, tier, text }) =>
          `"${capability}" attributed to ${TIER_MANIFEST[tier].name}, which does not grant it ` +
          `(lowest granting plan: ${TIER_MANIFEST[minimumTierForCapability(capability)].name}) — ` +
          `in: ${text.slice(0, 160)}`,
      ),
    ).toEqual([]);
  });

  it('never claims a feature is exclusive to a plan above its cheapest one', () => {
    const bad: string[] = [];
    for (const text of CORPUS) {
      const claimed = exclusiveTiersIn(text);
      if (claimed.length === 0) continue;

      const mentioned = (Object.entries(FEATURE_NOUNS) as Array<[Capability, RegExp]>)
        .filter(([, noun]) => noun.test(text))
        .map(([capability]) => capability);
      if (mentioned.length === 0) continue;

      for (const tier of claimed) {
        // Clean if the named plan is the cheapest one granting ANY
        // feature the passage discusses. A passage may legitimately
        // name several features; requiring every one to bottom out at
        // the same plan would flag honest prose.
        const justified = mentioned.some((cap) => minimumTierForCapability(cap) === tier);
        if (justified) continue;
        bad.push(
          `exclusive to ${TIER_MANIFEST[tier].name}, but ` +
            mentioned
              .map(
                (cap) => `"${cap}" starts at ${TIER_MANIFEST[minimumTierForCapability(cap)].name}`,
              )
              .join(', ') +
            ` — in: ${text.slice(0, 200)}`,
        );
      }
    }
    expect(bad).toEqual([]);
  });

  it('detects an exclusivity claim at all (mechanics)', () => {
    // The rule above is a filter, and a filter that matches nothing
    // reports clean. This pins the matcher itself against a synthetic
    // passage, so a regex that silently stops matching fails HERE
    // rather than turning the real check into a no-op.
    expect(exclusiveTiersIn('Autopilot is only on Pro today.')).toEqual(['pro']);
    expect(exclusiveTiersIn('This one requires Plus.')).toEqual(['plus']);
    expect(exclusiveTiersIn('A Pro-only surface.')).toEqual(['pro']);
    expect(exclusiveTiersIn('Available on Plus and Pro.')).toEqual([]);
  });

  it('never contrasts two plans that hold a feature identically', () => {
    // The gap the two rules above cannot see. "On Plus, Autopilot waits
    // for your approval. On Pro, rules handle future matches
    // automatically" contains no exclusivity word and attributes nothing
    // to a plan that lacks it — every clause is individually true. The
    // falsehood is the CONTRAST: it tells the reader the plans differ on
    // a feature they hold identically.
    //
    // The marker must be ANCHORED TO A PLAN NAME. A bare "instead" or
    // "but" also contrasts two modes, two verbs, two anything — the FAQ
    // sentence "you preview what a rule would do … You can instead run a
    // rule in Observe" tripped an unanchored version while being
    // perfectly true. Case-sensitive: plan names are proper nouns in
    // copy, and lowercase "free"/"pro" are ordinary English words.
    // The comma after the plan name was doing real work and was wrong:
    // "On Pro you can turn on a rule…" and "on Plus they collect…" both
    // slipped past. Made optional.
    const TIER_ALT = TIER_IDS.map((id) => TIER_MANIFEST[id].name).join('|');
    const CONTRAST = new RegExp(
      `\\b[Oo]n (?:${TIER_ALT})\\b\\s*,?\\s+(?:you|they|it|rules?|a\\b)|` +
        `\\b(?:but|whereas|while)\\b[^.]{0,60}\\b(?:${TIER_ALT})\\b|` +
        `\\b(?:${TIER_ALT})\\b[^.]{0,30}\\b(?:but|whereas|while)\\b`,
    );
    const bad: string[] = [];
    for (const text of CORPUS) {
      if (!CONTRAST.test(text)) continue;
      const tiers = TIER_NAME_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(
        ({ tier }) => tier,
      );
      if (tiers.length < 2) continue;
      const caps = (Object.entries(FEATURE_NOUNS) as Array<[Capability, RegExp]>)
        .filter(([, noun]) => noun.test(text))
        .map(([capability]) => capability);
      if (caps.length === 0) continue;

      // Suspect only when EVERY named plan grants EVERY named feature —
      // then there is no difference for the contrast to be about.
      const identical = caps.every((cap) => tiers.every((tier) => hasCapability(tier, cap)));
      if (identical) {
        bad.push(
          `contrasts ${tiers.map((t) => TIER_MANIFEST[t].name).join(' vs ')} over ` +
            `${caps.join(', ')}, which all of them grant — in: ${text.slice(0, 200)}`,
        );
      }
    }
    expect(bad).toEqual([]);
  });

  it('never quotes an inbox limit no tier carries', () => {
    // `inboxLimit` is a manifest FIELD, not a capability, so it has no
    // FEATURE_NOUNS entry and every rule above ignores it. "Pro supports
    // up to three inboxes" was false for a day and no rule could see it.
    const limits = new Set(TIER_IDS.map((id) => TIER_MANIFEST[id].inboxLimit));
    const inboxPassages = CORPUS.filter((t) => /\binbox(es)?\b/i.test(t)).map(normalizeNumbers);
    expect(inboxPassages.length, 'no inbox passages found to check').toBeGreaterThan(0);

    const bad: string[] = [];
    for (const text of inboxPassages) {
      // Only COUNT claims — "three inboxes", "up to 5 inboxes",
      // "5 connected inboxes". Bare "your inbox" carries no number.
      // `(?!\s+messages)` — "38 inbox messages" is a MESSAGE count in
      // a sender row, not a claim about how many inboxes a plan allows.
      for (const match of text.matchAll(
        /(\d+)\s+(?:connected\s+)?(?:Gmail\s+)?(?:inbox(?!\s+messages)|inboxes|accounts?)\b/gi,
      )) {
        const n = Number(match[1]);
        if (!limits.has(n)) bad.push(`${n} inboxes — in: ${text.slice(0, 160)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('catches the real stale sentences this gate was blind to (mechanics)', () => {
    // Regression fixtures: the exact strings that shipped false while
    // this file reported 8/8 green. Each names the rule that missed it.
    // A future widening that breaks one of these breaks it HERE, loudly,
    // instead of silently reopening the hole.
    const NUMBER_WORD_UNDO =
      'Free and Plus offer Undo for seven days, while Pro offers thirty days.';
    const INBOX_COUNT = 'Pro supports up to three inboxes and a seven-day Undo window.';
    // A sentence that exercises GATING specifically. The sibling
    // "acting without per-batch approval is Pro" is caught by the
    // CONTRAST rule instead — naming the right rule matters, or the
    // fixture passes for a reason unrelated to what it claims to pin.
    const DECLARATIVE_GATING = 'Pro supports up to three inboxes and includes Follow-ups.';

    // 1. Number words — the undo rule matched only digits.
    const windows = new Set(TIER_IDS.map((id) => TIER_MANIFEST[id].undoWindowDays));
    const undoDays = [...normalizeNumbers(NUMBER_WORD_UNDO).matchAll(/(\d+)[- ]day/gi)].map((m) =>
      Number(m[1]),
    );
    expect(undoDays).toContain(7);
    expect(windows.has(7), 'no tier carries a 7-day window any more').toBe(false);

    // 2. Inbox counts — no rule existed at all.
    const limits = new Set(TIER_IDS.map((id) => TIER_MANIFEST[id].inboxLimit));
    const inboxCounts = [
      ...normalizeNumbers(INBOX_COUNT).matchAll(
        /(\d+)\s+(?:connected\s+)?(?:Gmail\s+)?(?:inbox|inboxes|accounts?)\b/gi,
      ),
    ].map((m) => Number(m[1]));
    expect(inboxCounts).toContain(3);
    expect(limits.has(3), 'no tier carries a 3-inbox limit any more').toBe(false);

    // 3. Declarative voice — GATING was all prepositional.
    expect(GATING.test(DECLARATIVE_GATING)).toBe(true);
  });

  it('never quotes an undo window no tier carries', () => {
    const windows = new Set(TIER_IDS.map((id) => TIER_MANIFEST[id].undoWindowDays));
    // Any passage that talks about undo at all. The previous version
    // also required the word "Activity", which excluded real copy —
    // "Free and Plus offer Undo for seven days" never names Activity, so
    // the sentence was never inspected. The Gmail-Trash carve-out below
    // is what keeps that widening from over-firing.
    // Only passages about OUR product. The comparison modules describe
    // competitors' windows ("Fresh SaneBlackHole messages remain
    // reviewable for seven days"), which are facts about someone else's
    // product and must not be dragged toward our manifest.
    // Must name US or one of OUR plans. "Activity" alone is not enough:
    // a comparison row reads "Fresh SaneBlackHole messages remain
    // reviewable for seven days; a general Activity undo window is not
    // publicly stated" — a true statement about a competitor that named
    // our noun only to say they lack it.
    const aboutUs = (t: string) =>
      /\bDeclutrMail\b/i.test(t) || TIER_NAME_PATTERNS.some(({ pattern }) => pattern.test(t));
    const undoPassages = CORPUS.filter((t) => /\bundo(ne|able)?\b/i.test(t) && aboutUs(t)).map(
      normalizeNumbers,
    );
    expect(undoPassages.length, 'no undo passages found to check').toBeGreaterThan(0);

    const bad: string[] = [];
    for (const text of undoPassages) {
      for (const match of text.matchAll(/(\d+)[- ]day/gi)) {
        const days = Number(match[1]);
        // Gmail Trash is separately documented at ~30 days; only flag a
        // number that matches no tier AND is not that documented value.
        if (!windows.has(days) && days !== 30) {
          bad.push(`${days} days — in: ${text.slice(0, 160)}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
