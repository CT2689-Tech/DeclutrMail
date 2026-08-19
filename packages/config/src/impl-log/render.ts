/**
 * Rendering the implementation log's table and summary (D158).
 *
 * Pure string work, kept apart from the CLI so the shape of the file is
 * testable without a repo around it.
 */

import type { ComposedRow, State } from './types';

export const DECISIONS_START = '<!-- AUTO:DECISIONS:START -->';
export const DECISIONS_END = '<!-- AUTO:DECISIONS:END -->';
export const SUMMARY_START = '<!-- AUTO:SUMMARY:START -->';
export const SUMMARY_END = '<!-- AUTO:SUMMARY:END -->';

/** Escape raw pipes so a decision title can never break the table. */
export function cell(text: string): string {
  return text.replace(/\\\|/g, '|').replace(/\|/g, '\\|');
}

export function renderRows(rows: ComposedRow[]): string {
  const lines = [
    '| D# | Title | Status | Shipped by | Verified by | Notes |',
    '|---|---|---|---|---|---|',
  ];
  for (const r of rows) {
    lines.push(
      `| D${r.num} | ${cell(r.title)} | ${r.status} | ${cell(r.pr)} | ${cell(r.verifiedBy)} | ${cell(r.notes)} |`,
    );
  }
  return lines.join('\n');
}

const SUMMARY_ORDER: State[] = ['⬜', '🔵', '🟢', '🟡', '🔴', '⏸️', '🚫'];
const SUMMARY_LABEL: Record<State, string> = {
  '⬜': 'Not started',
  '🔵': 'Shipped',
  '🟢': 'Verified',
  '🟡': 'In progress',
  '🔴': 'Blocked',
  '⏸️': 'Deferred',
  '🚫': 'Retired',
};

export function renderSummary(rows: ComposedRow[]): string {
  const counts = new Map<State, number>();
  for (const r of rows) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  const parts = SUMMARY_ORDER.filter((s) => (counts.get(s) ?? 0) > 0).map(
    (s) => `${s} ${SUMMARY_LABEL[s]} ${counts.get(s)}`,
  );
  return [
    SUMMARY_START,
    '',
    `${rows.length} decisions — ${parts.join(' · ')}`,
    '',
    SUMMARY_END,
  ].join('\n');
}

/** Replace everything between two markers, markers included. */
export function spliceBlock(src: string, start: string, end: string, replacement: string): string {
  const from = src.indexOf(start);
  const to = src.indexOf(end);
  if (from === -1 || to === -1) return src;
  return src.slice(0, from) + replacement + src.slice(to + end.length);
}

/** Rebuild the whole file from composed rows. */
export function renderLog(current: string, rows: ComposedRow[]): string {
  let next = spliceBlock(
    current,
    DECISIONS_START,
    DECISIONS_END,
    `${DECISIONS_START}\n\n${renderRows(rows)}\n\n${DECISIONS_END}`,
  );
  next = spliceBlock(next, SUMMARY_START, SUMMARY_END, renderSummary(rows));
  return next;
}

/**
 * Rows whose rendered line differs between two versions of the file.
 * Used by the narrowed check to answer "is this PR's own claim wrong?"
 * rather than "has anything anywhere drifted?".
 */
export function driftedDecisions(current: string, next: string): number[] {
  const lineByNum = (text: string): Map<number, string> => {
    const map = new Map<number, string>();
    for (const line of text.split('\n')) {
      const match = /^\| D(\d{1,3}) \|/.exec(line);
      if (match) map.set(Number(match[1]), line);
    }
    return map;
  };
  const before = lineByNum(current);
  const after = lineByNum(next);
  const drifted: number[] = [];
  for (const [num, line] of after) {
    if (before.get(num) !== line) drifted.push(num);
  }
  for (const num of before.keys()) {
    if (!after.has(num)) drifted.push(num);
  }
  return [...new Set(drifted)].sort((a, b) => a - b);
}
