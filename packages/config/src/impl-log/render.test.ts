import { describe, expect, it } from 'vitest';
import {
  DECISIONS_END,
  DECISIONS_START,
  SUMMARY_END,
  SUMMARY_START,
  cell,
  driftedDecisions,
  renderLog,
  renderRows,
} from './render';
import type { ComposedRow } from './types';

const row = (over: Partial<ComposedRow> = {}): ComposedRow => ({
  num: 46,
  title: 'Decision history',
  status: '🔵',
  pr: '#115',
  verifiedBy: '',
  notes: '',
  ...over,
});

describe('renderRows', () => {
  it('names the citation column for what it now holds', () => {
    expect(renderRows([row()])).toContain('| Shipped by |');
  });

  it('escapes a pipe inside a title so it cannot break the table', () => {
    // D12's title contains a raw pipe — it broke the flip regex once.
    const rendered = renderRows([row({ title: 'sender_key = sha256("v1|" + email)' })]);
    const line = rendered.split('\n').find((l) => l.startsWith('| D46'))!;
    expect(line).toContain('sha256("v1\\|"');
    // Markdown counts UNESCAPED pipes: six cells means seven of them.
    // (A naive split('|') would count the escaped one too, which is
    // exactly the confusion the escape exists to prevent.)
    expect(line.match(/(?<!\\)\|/g)).toHaveLength(7);
  });

  it('is idempotent over an already-escaped title', () => {
    const once = renderRows([row({ title: 'a|b' })]);
    const twice = renderRows([row({ title: cell('a|b') })]);
    expect(once).toBe(twice);
  });
});

describe('renderLog', () => {
  const skeleton = [
    '# Log',
    '',
    DECISIONS_START,
    '',
    '| D# | Title | Status | Shipped by | Verified by | Notes |',
    '|---|---|---|---|---|---|',
    '| D46 | old | ⬜ |  |  |  |',
    '',
    DECISIONS_END,
    '',
    SUMMARY_START,
    '',
    'stale summary',
    '',
    SUMMARY_END,
    '',
  ].join('\n');

  it('replaces both blocks and leaves the prose around them alone', () => {
    const next = renderLog(skeleton, [row()]);
    expect(next).toContain('# Log');
    expect(next).toContain('| D46 | Decision history | 🔵 | #115 |');
    expect(next).not.toContain('stale summary');
    expect(next).toContain('1 decisions — 🔵 Shipped 1');
  });

  it('is stable — rendering the output again changes nothing', () => {
    const once = renderLog(skeleton, [row()]);
    expect(renderLog(once, [row()])).toBe(once);
  });
});

describe('driftedDecisions — which rows actually moved', () => {
  const before = ['| D1 | a | ⬜ |  |  |  |', '| D2 | b | 🔵 | #7 |  |  |'].join('\n');

  it('names only the row that changed', () => {
    const after = ['| D1 | a | 🔵 | #9 |  |  |', '| D2 | b | 🔵 | #7 |  |  |'].join('\n');
    expect(driftedDecisions(before, after)).toEqual([1]);
  });

  it('is empty when nothing moved', () => {
    expect(driftedDecisions(before, before)).toEqual([]);
  });

  it('notices a row that appeared or vanished', () => {
    const withNew = `${before}\n| D3 | c | ⬜ |  |  |  |`;
    expect(driftedDecisions(before, withNew)).toEqual([3]);
    expect(driftedDecisions(withNew, before)).toEqual([3]);
  });
});
