/**
 * The complete public-marketing content corpus, in one place.
 *
 * WHY THIS EXISTS (2026-08-27). Three CI truth-gates — `screener-truth`,
 * `engagement-truth` and `tier-truth` — each rebuilt this corpus from a
 * hand-maintained list of the same five imports. A sixth content module
 * was therefore invisible to all three: every assertion stayed green
 * while scanning none of the new prose, and each gate's coverage floor
 * (`expect(total).toBeGreaterThan(200)` and friends) is sized to the
 * EXISTING corpus, so the omission could not trip it either.
 *
 * That is the blind-guard defect this repo has shipped before, and which
 * `tier-truth.test.ts` names in its own header: a scanner over an empty
 * corpus passes every assertion while proving nothing. Three copies of a
 * hand-synced list is the same bug waiting on a fourth author.
 *
 * So: add a content module HERE, once, and all three gates pick it up.
 * `content-registry.test.ts` fails if a module under `learn/` or
 * `comparison/` exports content this file does not reference.
 */
import { COMPARISONS } from './comparison/comparison-data';
import { ANSWER_ARTICLES } from './learn/answer-content';
import { BLOG_ARTICLES } from './learn/blog-content';
import { CHANGELOG_ENTRIES } from './learn/changelog-content';
import { FAQ_ENTRIES } from './learn/faq-content';
import { ANSWERS_HUB, HOW_TO_HUB } from './learn/hub-content';
import { HOW_TO_ARTICLES } from './learn/how-to-content';

/**
 * Every content collection that renders on a public marketing route.
 *
 * Keyed by module so a failure message can name what it came from, and
 * so `content-registry.test.ts` can check the set against disk.
 */
export const MARKETING_CONTENT_SOURCES = {
  'learn/answer-content': { label: 'answers', content: ANSWER_ARTICLES },
  'learn/blog-content': { label: 'blog', content: BLOG_ARTICLES },
  'learn/changelog-content': { label: 'changelog', content: CHANGELOG_ENTRIES },
  'learn/faq-content': { label: 'faq', content: FAQ_ENTRIES },
  'learn/how-to-content': { label: 'how-to', content: HOW_TO_ARTICLES },
  // Hub eyebrows, titles, descriptions and meta chips, rendered on
  // /how-to and /answers. Found unscanned by any of the three truth-gates
  // on 2026-08-27, by the registry guard's first run — public prose that
  // had never been checked for the Screener, engagement or tier claims.
  'learn/hub-content': { label: 'hubs', content: [HOW_TO_HUB, ANSWERS_HUB] },
  'comparison/comparison-data': { label: 'comparisons', content: COMPARISONS },
} as const;

/** The registered content modules, for coverage assertions. */
export const MARKETING_CONTENT_MODULE_IDS = Object.keys(
  MARKETING_CONTENT_SOURCES,
) as readonly (keyof typeof MARKETING_CONTENT_SOURCES)[];

/**
 * `[label, collection]` pairs, the shape the per-source truth-gates scan.
 * The label appears in failure messages, so it names the cluster a
 * reader would recognize ("how-to"), not the module path.
 */
export const MARKETING_CONTENT_ENTRIES: readonly (readonly [string, unknown])[] = Object.values(
  MARKETING_CONTENT_SOURCES,
).map((source) => [source.label, source.content] as const);

/** Every content collection as one array, for corpus scanners. */
export const MARKETING_CONTENT_CORPUS: readonly unknown[] = Object.values(
  MARKETING_CONTENT_SOURCES,
).map((source) => source.content);
