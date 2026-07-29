#!/usr/bin/env tsx
/**
 * check-changelog.ts — is the public /changelog honest about git history?
 *
 * The public changelog is a CLAIMS surface. Two ways it goes wrong, both
 * observed on 2026-07-29 when it was regenerated after a 19-day gap:
 *
 *   1. OMISSION — a user-visible PR merged and no entry mentions it. The
 *      regeneration covered 2026-07-17 onward and silently dropped
 *      2026-07-14..07-21, which contained self-serve plan changes (#367),
 *      the purchase-attribution repair (#362) and the public site (#325).
 *   2. BACKDATING — an entry dated by its EARLIEST evidence commit, so
 *      later members read as having shipped days before they did (#374
 *      merged 07-24 but sat in a 07-22 entry).
 *
 * Both are invisible to typecheck, lint and the unit tests, because
 * nothing there compares the file against git. This does.
 *
 *   pnpm check-changelog
 *
 * Exit 0 = clean. Exit 1 = at least one omission or date mismatch.
 *
 * Deliberately NOT a vitest spec: it shells out to git, so it would make
 * the web unit suite depend on repository history being present.
 */

import { execFileSync } from 'node:child_process';
import { CHANGELOG_ENTRIES } from '../apps/web/src/features/marketing/learn/changelog-content.js';

/**
 * Conventional-commit types whose merges are infrastructure, not product.
 * Excluding them is an editorial decision, not an oversight: dressing CI
 * and vendor-watchdog work up as product changes is exactly what makes a
 * changelog stop being evidence.
 */
const NON_PRODUCT_TYPES = /^(chore|docs|ci|test|build|style)\b/;

/**
 * Scopes that are infrastructure whatever the type. `fix(ci)`,
 * `fix(scripts)` and `perf(workers)` all read as `fix`/`perf` but ship
 * nothing a user can see, so filtering on type alone reports them as
 * omissions and trains the reader to skim past real ones.
 */
const NON_PRODUCT_SCOPES = /^\w+\((ci|scripts|infra|e2e|deps|deps-dev)\)/;

/** Dependabot and other bot merges never earn a changelog line. */
const BOT_SUBJECT = /bump .+ from .+ to .+|dependabot/i;

/**
 * Merges that pass the type/scope filters but were JUDGED not user-visible.
 *
 * Recorded here with a reason rather than widened into a regex: a broader
 * pattern would also swallow the next genuinely user-facing change with
 * the same shape, and the omission would be silent. Adding a line here is
 * a deliberate editorial call that survives in review.
 */
const JUDGED_NOT_USER_VISIBLE: Readonly<Record<number, string>> = {
  313: 'reasoning-adapter timeout tuning — changes latency budget, not behavior',
  319: 'reasoning cache reuse — a cost optimization with identical output',
  338: 'idle Redis poll interval, dev phase only',
};

/**
 * `Merge pull request #N from owner/chore/thing` — an unsquashed merge
 * carries its conventional type in the BRANCH name, not the subject, so
 * the type regexes above cannot see it.
 */
const MERGE_OF_NON_PRODUCT_BRANCH = new RegExp(
  `^Merge pull request #\\d+ from [^/]+/(${NON_PRODUCT_TYPES.source.replace(/^\^|\\b$/g, '')})/`,
);

function isProductMerge(subject: string): boolean {
  return (
    !NON_PRODUCT_TYPES.test(subject) &&
    !NON_PRODUCT_SCOPES.test(subject) &&
    !BOT_SUBJECT.test(subject) &&
    !MERGE_OF_NON_PRODUCT_BRANCH.test(subject)
  );
}

interface Merge {
  readonly sha: string;
  readonly date: string;
  readonly subject: string;
  readonly pullRequest: number;
}

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' });
}

/** `feat(x): thing (D1) (#123)` or `Merge pull request #123 from …` */
function pullRequestNumber(subject: string): number | null {
  const squashed = subject.match(/\(#(\d+)\)\s*$/);
  if (squashed) return Number(squashed[1]);
  const merged = subject.match(/^Merge pull request #(\d+)\b/);
  return merged ? Number(merged[1]) : null;
}

function mergesSince(since: string): Merge[] {
  const raw = git('log', '--first-parent', `--since=${since}`, '--pretty=%h%cd%s', '--date=short');
  return raw
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      const [sha, date, subject] = line.split('');
      if (!sha || !date || !subject) return [];
      const pullRequest = pullRequestNumber(subject);
      if (pullRequest === null) return [];
      return [{ sha, date, subject, pullRequest }];
    });
}

function main(): void {
  if (CHANGELOG_ENTRIES.length === 0) {
    console.error('✗ CHANGELOG_ENTRIES is empty.');
    process.exit(1);
  }

  const dates = CHANGELOG_ENTRIES.map((entry) => entry.date).sort();
  const oldest = dates[0] as string;
  const merges = mergesSince(oldest);

  const cited = new Map<number, string>();
  for (const entry of CHANGELOG_ENTRIES) {
    for (const evidence of entry.evidence) cited.set(evidence.pullRequest, entry.date);
  }

  // 1. OMISSION — a product-bearing merge with no entry citing it.
  const omissions = merges.filter(
    (m) =>
      !cited.has(m.pullRequest) &&
      isProductMerge(m.subject) &&
      !(m.pullRequest in JUDGED_NOT_USER_VISIBLE),
  );

  // 2. BACKDATING — an entry whose date is not the merge date of the
  //    commit it cites. Forward-dating is the same defect mirrored, so
  //    this compares for equality rather than for "not earlier than".
  const mergeDateBySha = new Map(merges.map((m) => [m.sha, m.date]));
  const misdated: string[] = [];
  for (const entry of CHANGELOG_ENTRIES) {
    for (const evidence of entry.evidence) {
      const actual = mergeDateBySha.get(evidence.commit);
      // Unknown sha = a commit older than the window we walked; the unit
      // tests already pin the shape, and rewriting history is not a case
      // worth failing a build over.
      if (actual && actual !== entry.date) {
        misdated.push(
          `  entry ${entry.date} cites PR #${evidence.pullRequest} (${evidence.commit}), merged ${actual}`,
        );
      }
    }
  }

  if (omissions.length === 0 && misdated.length === 0) {
    const excluded = Object.keys(JUDGED_NOT_USER_VISIBLE).length;
    console.log(
      `✓ /changelog covers every product merge since ${oldest} (${merges.length} merges walked, ${cited.size} cited), and every entry date matches its evidence.`,
    );
    // Never let a suppression stay silent — a check that hides what it
    // dropped reads as "covered everything" when it did not.
    console.log(`  ${excluded} merge(s) judged not user-visible and excluded on purpose:`);
    for (const [pr, why] of Object.entries(JUDGED_NOT_USER_VISIBLE)) {
      console.log(`    #${pr} — ${why}`);
    }
    return;
  }

  if (omissions.length > 0) {
    console.error(
      `✗ ${omissions.length} product merge(s) since ${oldest} have no changelog entry:`,
    );
    for (const m of omissions) console.error(`  ${m.date}  #${m.pullRequest}  ${m.subject}`);
    console.error(
      '\n  Add an entry, or — if it is genuinely not user-visible — retype the commit\n  (chore/ci/test/build) so the exclusion is recorded rather than assumed.',
    );
  }
  if (misdated.length > 0) {
    console.error(`\n✗ ${misdated.length} evidence commit(s) do not match their entry date:`);
    for (const line of misdated) console.error(line);
    console.error(
      '\n  Split the entry by merge date. Grouping by the earliest member backdates the rest.',
    );
  }
  process.exit(1);
}

main();
