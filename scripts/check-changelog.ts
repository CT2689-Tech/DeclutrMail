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
 * Runs automatically via lint-staged whenever changelog-content.ts is
 * staged — the file is edited rarely enough that a manual-only check
 * would simply never be run.
 *
 * Exits 1 on any of:
 *   - a product merge no entry cites (OMISSION)
 *   - an evidence commit whose merge date ≠ its entry's date (BACKDATING)
 *   - a cited commit that does not resolve, or belongs to a different PR
 *   - history it cannot see (shallow clone, truncated walk, empty window)
 *
 * That last one matters most: every filter here runs OVER the merge walk,
 * so an empty walk makes them all vacuously clean. Failing closed on a
 * blind run is the difference between a guard and a green light.
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
 * the type regexes above cannot see it. Matched by pulling the branch
 * prefix out and testing it directly, rather than by splicing
 * NON_PRODUCT_TYPES.source into another pattern: the string surgery that
 * would need (stripping `^` and `\b`) silently produces a wrong matcher
 * the moment someone edits the source regex.
 */
const UNSQUASHED_MERGE_BRANCH = /^Merge pull request #\d+ from [^/]+\/([^/]+)\//;

function isProductMerge(subject: string): boolean {
  const branchPrefix = subject.match(UNSQUASHED_MERGE_BRANCH)?.[1];
  if (branchPrefix && NON_PRODUCT_TYPES.test(branchPrefix)) return false;
  return (
    !NON_PRODUCT_TYPES.test(subject) &&
    !NON_PRODUCT_SCOPES.test(subject) &&
    !BOT_SUBJECT.test(subject)
  );
}

interface Merge {
  readonly sha: string;
  readonly date: string;
  readonly subject: string;
  readonly pullRequest: number;
}

/**
 * Every git call is pinned to UTC.
 *
 * `--date=short` renders in the LOCAL zone and `--since` compares against
 * it, so the same commit reads as a different date on a laptop in PDT and
 * a runner in UTC. An entry-date equality check built on that would pass
 * for the author and fail in CI (or worse, the reverse). One authority
 * for "what day did this merge", everywhere.
 */
function git(args: string[], input?: string): string {
  return execFileSync('git', args, {
    encoding: 'utf8',
    input,
    env: { ...process.env, TZ: 'UTC' },
  });
}

/**
 * Field-separated `git log`, as ONE helper.
 *
 * This exists because the two call sites previously each carried their own
 * `--pretty` string and their own `.split()`, with a raw U+0001 byte in
 * both — invisible in an editor and in review. One of them lost its
 * separator in an edit (`%h%s` + `split('')`, which splits into single
 * CHARACTERS), so its lookup map was garbage, every `.get()` returned
 * undefined, and the receipt-to-PR check silently never fired. It looked
 * verified because a NEIGHBOURING check failed on the same fixture.
 *
 * Two places that must agree on a delimiter will eventually disagree. One
 * place cannot.
 */
function logFields(revArgs: string[], fields: readonly string[]): string[][] {
  const SEP = '\u0001'; // must match the %x01 joined into the format above
  const out = git([...revArgs, `--pretty=format:${fields.join('%x01')}`]);
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split(SEP))
    .filter((parts) => {
      // A row that did not split into the requested arity means the format
      // and the separator have drifted apart again. Fail loud rather than
      // silently dropping rows, which is how the last one hid.
      if (parts.length !== fields.length) {
        console.error(
          `✗ git log returned ${parts.length} field(s) where ${fields.length} were requested.\n` +
            '  The --pretty format and the separator have drifted. This is a bug in this script.',
        );
        process.exit(1);
      }
      return true;
    });
}

/**
 * Refuse to run against history we cannot actually see.
 *
 * `actions/checkout` defaults to `fetch-depth: 1`. On a shallow clone the
 * merge walk returns nothing, every filter over it is vacuously empty,
 * and this script prints "covers every product merge" having walked zero
 * — a permanently-green, permanently-blind guard, which is the exact
 * failure this repo has now hit three times (the healthz probe with no
 * dependencies, pr-merged.yml's push that branch protection always
 * rejected, verify-d recording verifications it never ran).
 *
 * A check that cannot see its subject must fail, never pass.
 */
function assertHistoryIsVisible(oldestEntryDate: string, merges: Merge[]): void {
  if (git(['rev-parse', '--is-shallow-repository']).trim() === 'true') {
    console.error(
      '✗ Shallow clone — the merge walk cannot see history, so this check would pass without\n' +
        '  verifying anything. Check out with full history:\n\n' +
        '      - uses: actions/checkout@v7\n' +
        '        with:\n' +
        '          fetch-depth: 0\n',
    );
    process.exit(1);
  }
  if (merges.length === 0) {
    console.error(
      `✗ No merges found since ${oldestEntryDate}. Either the changelog dates are wrong or the\n` +
        '  repository history is truncated. Refusing to report coverage over an empty walk.',
    );
    process.exit(1);
  }
  // Not-formally-shallow truncation (a graft, a filtered clone, a rewritten
  // base) shows up here: the walk must reach at least as far back as the
  // oldest entry it claims to cover.
  const earliestWalked = merges.reduce((a, m) => (m.date < a ? m.date : a), merges[0]!.date);
  if (earliestWalked > oldestEntryDate) {
    console.error(
      `✗ History walk starts at ${earliestWalked} but the oldest entry is dated ${oldestEntryDate}.\n` +
        '  The window is truncated, so an omission before that point would go unreported.',
    );
    process.exit(1);
  }
}

interface Receipt {
  readonly entry: string;
  readonly commit: string;
  readonly pullRequest: number;
}

interface ResolvedReceipt extends Receipt {
  readonly mergedOn: string;
  readonly subject: string;
}

/**
 * Resolve every cited receipt to the real commit it names — or fail.
 *
 * Two rules here, both learned the hard way on this file:
 *
 * 1. NEVER key on an abbreviated sha. `%h` width is auto-scaled by git
 *    from repository size (`core.abbrev` unset = auto), so a map keyed by
 *    `%h` and looked up with the changelog's fixed 8-char strings starts
 *    missing EVERY entry the day git decides on 9. Demonstrated: at
 *    `core.abbrev=12` the PR-ownership check stopped reporting a receipt
 *    filed under the wrong PR entirely. Everything below joins on the
 *    full 40-char sha.
 *
 * 2. NEVER treat a failed lookup as a pass. The previous version did
 *    `if (!subject) return false` — "I could not look this up" scored as
 *    "verified fine", which is how (1) stayed silent. A receipt that
 *    cannot be resolved is a FAILURE, not a skip.
 */
function resolveReceipts(): ResolvedReceipt[] {
  const cited: Receipt[] = CHANGELOG_ENTRIES.flatMap((entry) =>
    entry.evidence.map((evidence) => ({
      entry: entry.date,
      commit: evidence.commit,
      pullRequest: evidence.pullRequest,
    })),
  );

  // Abbreviation -> full sha. `missing`/`ambiguous` land here as-is.
  const probe = git(
    ['cat-file', '--batch-check'],
    cited.map((c) => `${c.commit}^{commit}`).join('\n'),
  )
    .split('\n')
    .filter(Boolean);
  if (probe.length !== cited.length) {
    console.error(
      `✗ Resolved ${probe.length} object(s) for ${cited.length} receipt(s). Refusing to guess which is which.`,
    );
    process.exit(1);
  }
  const unresolved = cited.filter((_, i) => !/^[0-9a-f]{40} commit /.test(probe[i] as string));
  if (unresolved.length > 0) {
    console.error(`✗ ${unresolved.length} cited commit(s) do not resolve in this repository:`);
    for (const c of unresolved) {
      console.error(`  entry ${c.entry} cites #${c.pullRequest} (${c.commit})`);
    }
    process.exit(1);
  }
  const fullSha = new Map(cited.map((c, i) => [c, (probe[i] as string).slice(0, 40)]));

  // One --no-walk pass keyed on the FULL sha, so nothing depends on how
  // wide git feels like abbreviating today.
  const details = new Map(
    logFields(
      ['log', '--no-walk', '--date=short', ...new Set([...fullSha.values()])],
      ['%H', '%cd', '%s'],
    ).map(([sha, date, subject]) => [
      sha as string,
      { date: date as string, subject: subject as string },
    ]),
  );

  const resolved = cited.map((c) => {
    const detail = details.get(fullSha.get(c) as string);
    if (!detail) {
      // Cannot happen after the probe above — which is exactly why it must
      // be loud if it ever does, instead of quietly skipping the comparison.
      console.error(
        `✗ Receipt #${c.pullRequest} (${c.commit}) resolved to an object git then would not describe.\n` +
          '  Refusing to report this receipt as verified.',
      );
      process.exit(1);
    }
    return { ...c, mergedOn: detail.date, subject: detail.subject };
  });

  const mismatched = resolved.filter((r) => {
    const actual = pullRequestNumber(r.subject);
    return actual !== null && actual !== r.pullRequest;
  });
  if (mismatched.length > 0) {
    console.error(`✗ ${mismatched.length} receipt(s) cite a commit belonging to a different PR:`);
    for (const r of mismatched) {
      console.error(
        `  entry ${r.entry} cites #${r.pullRequest} (${r.commit}) — that commit is ${r.subject}`,
      );
    }
    process.exit(1);
  }

  return resolved;
}

/** `feat(x): thing (D1) (#123)` or `Merge pull request #123 from …` */
function pullRequestNumber(subject: string): number | null {
  const squashed = subject.match(/\(#(\d+)\)\s*$/);
  if (squashed) return Number(squashed[1]);
  const merged = subject.match(/^Merge pull request #(\d+)\b/);
  return merged ? Number(merged[1]) : null;
}

function mergesSince(since: string): Merge[] {
  return logFields(
    ['log', '--first-parent', `--since=${since}`, '--date=short'],
    ['%h', '%cd', '%s'],
  ).flatMap(([sha, date, subject]) => {
    const pullRequest = pullRequestNumber(subject as string);
    if (pullRequest === null) return [];
    return [{ sha: sha as string, date: date as string, subject: subject as string, pullRequest }];
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

  // Before reporting on anything: prove we can actually see the history,
  // and that every receipt on the page is real. Both fail closed.
  assertHistoryIsVisible(oldest, merges);
  const receipts = resolveReceipts();

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
  //
  //    Driven off `receipts`, where every commit is already resolved and
  //    dated, rather than off a lookup into the merge-window map. That
  //    map is keyed by abbreviated sha and only covers the walked window,
  //    so a miss meant "silently skip this comparison" — the same
  //    could-not-verify-scored-as-verified shape that hid the broken
  //    PR-ownership check. There is no miss case here by construction:
  //    resolveReceipts() has already failed the run for anything it could
  //    not resolve.
  const misdated = receipts
    .filter((r) => r.mergedOn !== r.entry)
    .map(
      (r) => `  entry ${r.entry} cites PR #${r.pullRequest} (${r.commit}), merged ${r.mergedOn}`,
    );

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
