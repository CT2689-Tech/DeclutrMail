/**
 * Deriving the implementation log's computed half (D158).
 *
 * Two rules carry the whole design:
 *
 *   1. A decision cites the PR that SHIPPED it — the first one — not
 *      every PR that has since touched it. The growing list was the
 *      churn: `D49` accumulated fourteen citations, and each merge that
 *      added one rewrote that row and conflicted with whatever else was
 *      in flight. A row now changes when its status changes, which is
 *      once or twice in its life.
 *
 *   2. Docs-only PRs RECORD a decision, they do not implement it. The PR
 *      that adds D248 to the plan says `Closes D248`; flipping D248 to
 *      Shipped on it would assert a feature that does not exist.
 */

import type { ComposedRow, Decision, Fragment, PrRef, State } from './types';

/**
 * A trailer is a LINE that closes a decision — optionally list-marked —
 * not any prose containing the words. A PR body that QUOTES `Closes
 * D248` while explaining the rule is not closing D248.
 */
export const CLOSES_RE = /^(?:[-*]\s+)?Closes\s+D(\d{1,3})\b/gim;

/** A PR implements (vs merely records) iff it touches any non-md file. */
export function isImplementing(pr: PrRef): boolean {
  return pr.files.some((f) => !f.path.toLowerCase().endsWith('.md'));
}

/** D-numbers a PR body closes. */
export function closedDecisions(body: string): number[] {
  const nums: number[] = [];
  CLOSES_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CLOSES_RE.exec(body ?? '')) !== null) {
    const num = Number(match[1]);
    if (!nums.includes(num)) nums.push(num);
  }
  return nums;
}

/**
 * D-number → the PR that shipped it (the lowest-numbered implementing PR
 * that closes it). Later PRs touching the same decision are real history,
 * but they are history GitHub already keeps: `Closes D24` in search
 * returns them all, and storing the list here bought one merge conflict
 * per parallel PR.
 */
export function deriveShippedBy(prs: PrRef[]): Map<number, number> {
  const shipped = new Map<number, number>();
  for (const pr of prs) {
    if (!isImplementing(pr)) continue;
    for (const num of closedDecisions(pr.body ?? '')) {
      const existing = shipped.get(num);
      if (existing === undefined || pr.number < existing) shipped.set(num, pr.number);
    }
  }
  return shipped;
}

/** Does the evidence cite a repo file, and does that file still exist? */
export type EvidenceCheck = (evidence: string) => 'no-path' | 'exists' | 'missing';

/**
 * Compose one row from the plan, the derivation, and whatever was
 * recorded. Pure: the caller supplies the evidence check so this stays
 * testable without a filesystem.
 */
/**
 * The repo file an evidence string cites, or `null` if it cites none.
 *
 * The 🟢 audit demotes a Verified row whose cited file has vanished, so
 * everything this returns is load-bearing — and it has been wrong four
 * times:
 *
 * 1. **Alternation order.** `(?:ts|tsx)` takes the first branch that
 *    matches, so `…noise-archive.test.tsx` truncated to a `.ts` path
 *    that does not exist. Six decisions were demoted with "the cited
 *    evidence file no longer exists" written into rows whose files sat
 *    right there. EXTENSIONS STAY ORDERED LONGEST-FIRST.
 * 2. **`cmd:` receipts are not citations.** `verify-d --cmd` records the
 *    command it ran, and a workspace-scoped one carries a
 *    workspace-relative path (`pnpm --filter @declutrmail/web … run
 *    src/…/action-sheet.test.tsx`). Resolved against the repo root that
 *    file is missing, so the audit would demote the row whose evidence
 *    is strongest: a command that ran and exited 0 at a recorded commit.
 * 3. **Quadratic scan** (CodeQL, high). The original was one unanchored
 *    pattern over the whole string, so the engine restarted at every
 *    offset and re-consumed a long run of class characters at each —
 *    O(n²), 137 ms on 8 KB of `-`. Rewriting the pattern to remove its
 *    internal ambiguity did NOT fix that; measuring showed the restarts
 *    were the cost, not the ambiguity.
 *
 * 4. **The trailing-dot trim, same shape again.** The tokenizer in (3)
 *    stripped sentence punctuation with `/\.+$/`, which is anchored at
 *    the END but not the START — so a long run of dots not at the end
 *    restarts at every offset. 5.3 s on 64 KB. The timing guard written
 *    for (3) missed it because its inputs were runs of `-`, not `.`; it
 *    now covers six shapes, and every remaining pattern here was
 *    measured against all six.
 *
 * So the scan is now tokenized: evidence splits on whitespace, and each
 * token is matched ANCHORED, which is linear (256 KB in under 10 ms).
 * The trade is that a path must be its own whitespace-delimited token —
 * surrounding punctuation and a trailing `:12` are stripped, so
 * `(store.ts:32 documents it)` still resolves, but a path glued to
 * prose with no space would not. All 95 recorded evidence and note
 * strings parse identically to the pre-rewrite behaviour.
 *
 * The first two failures had no test, which is why the first ran for a
 * month over every recorded 🟢.
 */
const LEADING_PUNCTUATION = /^[^\w@/-]+/;
const PATH_RUN = /^[\w@./-]+/;
const CITED_PATH = /^[\w@/-]+(?:\.[\w@/-]+)*\.(?:tsx|ts|sql|sh|md)$/;

export function citedEvidencePath(evidence: string): string | null {
  if (evidence.startsWith('cmd:')) return null;
  for (const token of evidence.split(/\s+/)) {
    const run = PATH_RUN.exec(token.replace(LEADING_PUNCTUATION, ''));
    if (!run) continue;
    // A trailing `.` is sentence punctuation, never part of the path.
    // Trimmed by hand, not by `/\.+$/`: that pattern is unanchored at the
    // START, so on a long run of dots NOT at the end it restarts at every
    // offset — 5.3 s on 64 KB, the second CodeQL alert on this function.
    let end = run[0].length;
    while (end > 0 && run[0][end - 1] === '.') end -= 1;
    const candidate = run[0].slice(0, end);
    if (CITED_PATH.test(candidate)) return candidate;
  }
  return null;
}

export function composeRow(
  decision: Decision,
  fragment: Fragment | undefined,
  shippedBy: number | undefined,
  evidenceCheck: EvidenceCheck,
  auditDate: string,
  demotions: string[],
): ComposedRow {
  const derivedPr = shippedBy !== undefined ? `#${shippedBy}` : '';
  const row: ComposedRow = {
    num: decision.num,
    title: decision.title,
    status: '⬜',
    // A recorded (pre-trailer) citation stands in only when nothing was
    // derived — never both, or the column starts growing again.
    pr: derivedPr || (fragment?.pr ?? ''),
    verifiedBy: fragment?.verifiedBy ?? '',
    notes: fragment?.note ?? '',
  };

  const recorded = fragment?.status;

  // Recorded terminal states win outright — retired, deferred, blocked
  // and in-progress are claims no derivation can make.
  if (recorded === '🚫' || recorded === '⏸️' || recorded === '🔴' || recorded === '🟡') {
    row.status = recorded as State;
    return row;
  }

  if (recorded === '🟢') {
    const evidence = row.verifiedBy.trim();
    const bare = evidence === '' || /^manual$/i.test(evidence);
    const fileStatus = evidenceCheck(evidence);
    if (bare || fileStatus === 'missing') {
      const reason = bare
        ? 'no executable or observed evidence was ever recorded'
        : 'the cited evidence file no longer exists';
      row.status = '🔵';
      row.notes = [
        row.notes,
        `Evidence audit ${auditDate} (🟢→🔵): ${reason}; re-verify via \`pnpm verify-d\``,
      ]
        .filter(Boolean)
        .join('. ');
      demotions.push(`D${decision.num}: ${reason}`);
    } else {
      row.status = '🟢';
    }
    return row;
  }

  if (shippedBy !== undefined) {
    row.status = '🔵';
    return row;
  }

  // A recorded 🔵 carrying a pre-trailer PR reference — trust it.
  if (recorded === '🔵' && row.pr.trim() !== '') {
    row.status = '🔵';
    return row;
  }

  return row;
}

/**
 * The decisions a PR is answerable for: the ones it closes, plus the
 * ones whose recorded state it edits.
 *
 * This is what makes the gate honest. Comparing the whole file failed a
 * PR for rows it had never heard of — five PRs in flight on 2026-08-11
 * spent their reviews laundering each other's drift by hand. A PR should
 * be red for its own claims and nobody else's.
 */
export function decisionsOwnedBy(prBody: string, changedFiles: string[]): Set<number> {
  const owned = new Set<number>(closedDecisions(prBody));
  for (const path of changedFiles) {
    const match = /(?:^|\/)\.impl-log\/D(\d{1,3})\.md$/.exec(path);
    if (match) owned.add(Number(match[1]));
  }
  return owned;
}
