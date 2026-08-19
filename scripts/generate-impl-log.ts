#!/usr/bin/env tsx
/**
 * generate-impl-log.ts — the DERIVED implementation log (D158, 2026-07-28;
 * reshaped 2026-08-19).
 *
 * History: a GitHub Action (`pr-merged.yml`) used to push status flips
 * straight to `main`. Branch protection rejected that push on every run —
 * it NEVER once wrote a flip. Derivation replaced maintenance:
 *
 *   ⬜ / 🔵 and the shipping PR are DERIVED — recomputed from the plan
 *          and from `Closes D###` trailers on merged PRs plus the PR this
 *          run is for.
 *   🟢 🚫 🟡 🔴 ⏸️, evidence and notes are RECORDED — human knowledge that
 *          exists nowhere else. It lives in `.impl-log/D###.md`, ONE FILE
 *          PER DECISION.
 *
 * Why one file per decision (2026-08-19): the recorded half used to live
 * inside the rendered table, so every PR that flipped a row rewrote the
 * same file and collided with every other PR in flight. One PR spent
 * four rounds resolving that conflict in a single afternoon. Fragments
 * make the collision structurally impossible — two PRs recording
 * different decisions never touch the same path.
 *
 * And the citation column holds the PR that SHIPPED a decision, not
 * every PR that has since touched it. `D49` had collected fourteen
 * references; each merge appending one was a rewrite of that row. The
 * rest of the history is `Closes D49` in GitHub search.
 *
 * Docs-only PRs RECORD a decision, they do not implement it: a merged PR
 * counts as implementing only if it touches a non-`.md` file. (The PR
 * that ADDS D248 to the plan says `Closes D248`; flipping D248 on it
 * would assert a feature that does not exist.)
 *
 * 🟢 audit (D158 call 4): a Verified row must carry evidence. A 🟢 with an
 * empty evidence field, a literal `manual`, or a cited file that no
 * longer exists is demoted to 🔵 with a note. Re-earn it with
 * `pnpm verify-d`.
 *
 * Modes:
 *   pnpm generate-impl-log             regenerate IMPLEMENTATION-LOG.md
 *   pnpm generate-impl-log --check     fail only on rows THIS PR owns
 *   pnpm generate-impl-log --check --strict
 *                                      fail on any drift (merge queue:
 *                                      the candidate is what becomes main)
 *
 * Requires `gh` (authenticated locally; GH_TOKEN in CI). If the merged-PR
 * set cannot be read this script FAILS LOUDLY — it never treats an
 * unreadable list as empty, because "no data" rendered as "no PRs" is the
 * exact blindness that let stale state accumulate before (MISTAKES.md
 * 2026-07-26).
 *
 * Exit codes:
 *   0 — log written (or --check passed)
 *   1 — plan not found / no decisions parsed / --check failed
 *   2 — IMPLEMENTATION-LOG.md missing the AUTO markers
 *   3 — merged-PR set unreadable (gh failed)
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  DECISIONS_END,
  DECISIONS_START,
  composeRow,
  decisionsOwnedBy,
  deriveShippedBy,
  driftedDecisions,
  fragmentNumber,
  parseFragment,
  renderLog,
  type ComposedRow,
  type Decision,
  type Fragment,
  type PrRef,
} from '@declutrmail/config/impl-log';

const REPO_ROOT = join(import.meta.dirname ?? __dirname, '..');
const LOG_PATH = join(REPO_ROOT, 'IMPLEMENTATION-LOG.md');
const FRAGMENT_DIR = join(REPO_ROOT, '.impl-log');
const MIRROR_PATH = join(REPO_ROOT, 'docs/execution/Implementation-Plan.md');
const LOCAL_PATH = join(homedir(), '.claude/plans/i-want-you-to-smooth-kahn.md');

const AUDIT_DATE = new Date().toISOString().slice(0, 10);

function resolvePlanPath(): string | null {
  if (existsSync(MIRROR_PATH)) return MIRROR_PATH;
  if (existsSync(LOCAL_PATH)) return LOCAL_PATH;
  return null;
}

function parseDecisions(plan: string): Decision[] {
  const seen = new Set<number>();
  const decisions: Decision[] = [];
  const lineRegex = /^(?:#{1,6}\s+|\*\*)D(\d{1,3})(?:\*\*)?\s*[—\-.:]\s*(.+?)(?:\s*\*\*)?$/gm;

  let match: RegExpExecArray | null;
  while ((match = lineRegex.exec(plan)) !== null) {
    const num = Number(match[1]);
    const title = match[2].trim().replace(/\s+/g, ' ');
    if (seen.has(num)) continue;
    seen.add(num);
    decisions.push({ num, title });
  }

  decisions.sort((a, b) => a.num - b.num);
  return decisions;
}

/** Read every `.impl-log/D###.md`. A missing directory means none recorded. */
function readFragments(): Map<number, Fragment> {
  const fragments = new Map<number, Fragment>();
  if (!existsSync(FRAGMENT_DIR)) return fragments;
  for (const filename of readdirSync(FRAGMENT_DIR)) {
    const num = fragmentNumber(filename);
    if (num === null) continue;
    fragments.set(num, parseFragment(num, readFileSync(join(FRAGMENT_DIR, filename), 'utf8')));
  }
  return fragments;
}

/** Fail-loud merged-PR read. Never returns a silently-empty list. */
function readMergedPrs(): PrRef[] {
  let raw: string;
  try {
    raw = execFileSync(
      'gh',
      ['pr', 'list', '--state', 'merged', '--limit', '1000', '--json', 'number,body,files'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (error) {
    console.error('✗ Could not read merged PRs via `gh`. Refusing to treat that as "none".');
    console.error(String(error));
    process.exit(3);
  }
  return JSON.parse(raw) as PrRef[];
}

/**
 * The PR this run is for — an open PR, or the one riding in a merge-queue
 * candidate.
 *
 * Both matter for the same reason: the run has to count the PR's own
 * `Closes` trailers, or the derivation says ⬜ while the committed file
 * says 🔵 and the gate fails the PR for being right. In a `merge_group`
 * event there is no `pull_request` payload, but the queue ref carries the
 * number (`gh-readonly-queue/main/pr-579-<sha>`).
 */
function readCurrentPr(): PrRef | null {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  let number: number | null = null;

  if (eventPath && existsSync(eventPath)) {
    const event = JSON.parse(readFileSync(eventPath, 'utf8')) as {
      pull_request?: { number?: number };
      merge_group?: { head_ref?: string };
    };
    if (typeof event.pull_request?.number === 'number') {
      number = event.pull_request.number;
    } else if (typeof event.merge_group?.head_ref === 'string') {
      const match = /\/pr-(\d+)-/.exec(event.merge_group.head_ref);
      if (match) number = Number(match[1]);
    }
    if (number === null) return null;
  }

  const args = ['pr', 'view', '--json', 'number,body,files,state'];
  if (number !== null) args.splice(2, 0, String(number));
  let raw: string;
  try {
    raw = execFileSync('gh', args, {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      // "no pull requests found for branch X" is the ordinary pre-PR
      // case, not a warning worth printing on every local run.
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
  const pr = JSON.parse(raw) as PrRef & { state?: string };
  // In the queue the PR reads as MERGED or OPEN depending on timing; both
  // are the PR this candidate carries.
  return pr.state === 'CLOSED' ? null : pr;
}

/** Does the evidence cite a repo file, and does that file still exist? */
function evidenceFileStatus(evidence: string): 'no-path' | 'exists' | 'missing' {
  const m = /([\w@./-]+\.(?:ts|tsx|sql|sh|md))/.exec(evidence);
  if (!m) return 'no-path';
  return existsSync(join(REPO_ROOT, m[1])) ? 'exists' : 'missing';
}

function compose(
  decisions: Decision[],
  prs: PrRef[],
): { rows: ComposedRow[]; demotions: string[] } {
  const fragments = readFragments();
  const shippedBy = deriveShippedBy(prs);
  const demotions: string[] = [];
  const rows = decisions.map((d) =>
    composeRow(
      d,
      fragments.get(d.num),
      shippedBy.get(d.num),
      evidenceFileStatus,
      AUDIT_DATE,
      demotions,
    ),
  );
  return { rows, demotions };
}

function main(): void {
  const checkMode = process.argv.includes('--check');
  const strict = process.argv.includes('--strict');

  const planPath = resolvePlanPath();
  if (!planPath) {
    console.error(`✗ Plan not found. Checked:\n  - ${MIRROR_PATH}\n  - ${LOCAL_PATH}`);
    process.exit(1);
  }

  const decisions = parseDecisions(readFileSync(planPath, 'utf8'));
  if (decisions.length === 0) {
    console.error(`✗ No D-decisions parsed from ${planPath}`);
    process.exit(1);
  }

  const current = readFileSync(LOG_PATH, 'utf8');
  if (current.indexOf(DECISIONS_START) === -1 || current.indexOf(DECISIONS_END) === -1) {
    console.error(`✗ ${LOG_PATH} missing markers ${DECISIONS_START} ... ${DECISIONS_END}`);
    process.exit(2);
  }

  const merged = readMergedPrs();
  const currentPr = readCurrentPr();
  const { rows, demotions } = compose(decisions, currentPr ? [...merged, currentPr] : merged);
  const next = renderLog(current, rows);

  if (checkMode) {
    if (next === current) {
      console.log(`✓ IMPLEMENTATION-LOG.md is current (${rows.length} D-rows).`);
      return;
    }

    const drifted = driftedDecisions(current, next);
    const owned = currentPr
      ? decisionsOwnedBy(
          currentPr.body ?? '',
          currentPr.files.map((f) => f.path),
        )
      : new Set<number>();

    // A narrowed gate that cannot identify the PR would pass everything
    // — a guard whose input is starved reports ✓ having checked nothing,
    // which is the shape this repo keeps rediscovering. In CI that is a
    // failure, not a pass.
    if (!strict && currentPr === null && process.env.GITHUB_ACTIONS === 'true') {
      console.error(
        '✗ Could not identify the PR this run is for, so "only my rows" cannot be decided.',
        'Refusing to pass a check that examined nothing.',
      );
      process.exit(1);
    }

    // A summary that disagrees with rows that agree can only mean the
    // block was hand-edited — the counts are computed FROM the rows. It
    // can never be another PR's fault, so both modes fail on it.
    const summaryTampered = drifted.length === 0;
    const mine = strict ? drifted : drifted.filter((num) => owned.has(num));

    for (const num of drifted) {
      console.error(
        `  D${num}: drifted (${owned.has(num) ? 'this PR owns it' : 'another PR owns it'})`,
      );
    }

    if (summaryTampered) {
      console.error(
        '✗ The summary block disagrees with rows that are themselves current.',
        'The counts are derived FROM the rows, so this means the block was',
        'hand-edited. Run `pnpm generate-impl-log` and commit.',
      );
      process.exit(1);
    }

    if (mine.length === 0) {
      // Drift exists, but none of it is this PR's claim. Failing here is
      // how five PRs on 2026-08-11 ended up laundering each other's rows
      // by hand; the PR that owns each row will bring it along.
      console.log(
        `✓ No drift on the ${owned.size} decision(s) this PR owns. ` +
          `${drifted.length} other row(s) are stale and belong to other PRs.`,
      );
      return;
    }

    console.error(
      `✗ IMPLEMENTATION-LOG.md is stale on ${mine.length} row(s)` +
        `${strict ? '' : ' this PR owns'}. Run \`pnpm generate-impl-log\` and commit.`,
    );
    if (currentPr !== null) {
      console.error(
        `  (This run counted PR #${currentPr.number}'s own \`Closes\` trailers, so`,
        'regenerate AFTER opening the PR — generating before it exists misses them.)',
      );
    }
    process.exit(1);
  }

  writeFileSync(LOG_PATH, next);
  console.log(`✓ Wrote ${rows.length} D-rows to ${LOG_PATH} (plan: ${planPath}).`);
  if (demotions.length > 0) {
    console.log(`  Evidence audit demoted ${demotions.length} row(s) 🟢→🔵:`);
    for (const d of demotions) console.log(`    - ${d}`);
  }
}

/** Ensure `.impl-log/` exists before something tries to write into it. */
export function ensureFragmentDir(): void {
  if (!existsSync(FRAGMENT_DIR)) mkdirSync(FRAGMENT_DIR, { recursive: true });
}

main();
