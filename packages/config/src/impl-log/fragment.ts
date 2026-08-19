/**
 * `.impl-log/D###.md` — the recorded half for one decision.
 *
 * Format is deliberately boring: `key: value` lines under a heading, no
 * YAML dependency, no multi-line values. Every field a human records
 * today fits on one line, and a format that cannot express more is a
 * format that cannot silently swallow more.
 *
 * A missing file means "nothing recorded" — the decision is whatever the
 * derivation says it is. That is the common case: 186 of 244 rows.
 */

import { RECORDED_STATES, type Fragment, type RecordedState } from './types';

const FIELD_RE = /^(status|verified-by|note|pr):\s*(.*)$/;

/** Path for one decision's fragment, relative to the repo root. */
export function fragmentPath(num: number): string {
  return `.impl-log/D${num}.md`;
}

/** Parse `.impl-log/D###.md`. Unknown keys are ignored, never guessed at. */
export function parseFragment(num: number, text: string): Fragment {
  const fragment: Fragment = { num };
  for (const line of text.split('\n')) {
    const match = FIELD_RE.exec(line.trim());
    if (!match) continue;
    const key = match[1]!;
    const value = (match[2] ?? '').trim();
    if (value === '') continue;
    if (key === 'status') {
      if (value === '🔵' || (RECORDED_STATES as readonly string[]).includes(value)) {
        fragment.status = value as RecordedState | '🔵';
      }
      continue;
    }
    if (key === 'verified-by') fragment.verifiedBy = value;
    if (key === 'note') fragment.note = value;
    if (key === 'pr') fragment.pr = value;
  }
  return fragment;
}

/**
 * Render a fragment. Only fields that carry something are written, so a
 * diff on this file is always a real change in what we know — never a
 * reshuffle of empty keys.
 */
export function renderFragment(fragment: Fragment): string {
  const lines = [
    `# D${fragment.num}`,
    '',
    '<!-- Recorded state for this decision. Derived state (⬜/🔵 and the',
    '     shipping PR) is recomputed by `pnpm generate-impl-log` and is',
    '     NOT stored here. Delete this file to drop back to derived. -->',
    '',
  ];
  if (fragment.status) lines.push(`status: ${fragment.status}`);
  if (fragment.verifiedBy) lines.push(`verified-by: ${fragment.verifiedBy}`);
  if (fragment.note) lines.push(`note: ${fragment.note}`);
  if (fragment.pr) lines.push(`pr: ${fragment.pr}`);
  return `${lines.join('\n')}\n`;
}

/** Decision number from a fragment filename, or `null` if it isn't one. */
export function fragmentNumber(filename: string): number | null {
  const match = /^D(\d{1,3})\.md$/.exec(filename);
  return match ? Number(match[1]) : null;
}
