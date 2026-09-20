import { describe, expect, it } from 'vitest';

import { mergePinnedRows, type PinnedRow } from './pinned-rows';

type Row = { id: string; n: number };
const pin = (row: Row, index: number): PinnedRow<Row> => ({ row, index });

// Founder decision 2026-09-20: a row whose action finished STAYS where it
// is, marked done — the list must not jump under the cursor. A sender with
// nothing left drops out of the server's list on the refetch that follows
// every action, so the screen holds its last-seen row until the list is
// asked a different question (filter / sort / search / mailbox).
describe('mergePinnedRows', () => {
  const server: Row[] = [
    { id: 'a', n: 1 },
    { id: 'c', n: 3 },
  ];

  it('returns the server list untouched when nothing is pinned', () => {
    expect(mergePinnedRows(server, new Map())).toBe(server);
  });

  it('re-inserts a row the refetch dropped, at the place it was', () => {
    const pinned = new Map([['b', pin({ id: 'b', n: 2 }, 1)]]);
    expect(mergePinnedRows(server, pinned).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('prefers the SERVER row when it is still listed — fresh counts, no duplicate', () => {
    const pinned = new Map([['c', pin({ id: 'c', n: 999 }, 0)]]);
    expect(mergePinnedRows(server, pinned)).toEqual(server);
  });

  it('keeps several dropped rows in their original relative order', () => {
    const pinned = new Map([
      ['z', pin({ id: 'z', n: 9 }, 3)],
      ['b', pin({ id: 'b', n: 2 }, 1)],
    ]);
    expect(mergePinnedRows(server, pinned).map((r) => r.id)).toEqual(['a', 'b', 'c', 'z']);
  });

  it('clamps an index past the end of a list that shrank', () => {
    const pinned = new Map([['q', pin({ id: 'q', n: 5 }, 40)]]);
    expect(mergePinnedRows(server, pinned).map((r) => r.id)).toEqual(['a', 'c', 'q']);
  });
});
