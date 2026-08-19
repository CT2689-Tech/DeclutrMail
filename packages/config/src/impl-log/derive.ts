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
