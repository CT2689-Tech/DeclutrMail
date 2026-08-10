/**
 * Wire-boundary tests for the Activity fetcher.
 *
 * `fetchActivity` used to cast the envelope meta, so a BE field that was
 * renamed or dropped compiled clean and rendered a confident wrong
 * number on /activity — the UI-truth bug class. It now parses via
 * `ActivityListMetaSchema`. These lock in the two halves of that
 * contract: a well-formed meta survives the parse intact, and a
 * malformed one throws instead of degrading to a silent zero.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fetchActivity } from './activity';
import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';

const STATS = {
  archived: 4,
  unsubscribed: 2,
  kept: 7,
  later: 1,
  deleted: 3,
  followupsDismissed: 0,
  needsAttention: 1,
  noisePreventedPerMonth: 120,
};

const META = {
  pagination: { nextCursor: 'cur-2', hasMore: true, limit: 25 },
  stats: STATS,
  allTimeStats: { ...STATS, archived: 99, noisePreventedPerMonth: null },
  window: '30d',
  source: 'all',
  verbs: ['archive', 'unsubscribe_confirmed'],
  senderQuery: '',
  dateFrom: null,
  dateTo: null,
  outcomes: ['completed'],
};

function stubActivity(meta: unknown): void {
  installFetchStub([
    {
      method: 'GET',
      path: /^\/api\/activity$/,
      respond: () => jsonOk({ data: [], meta }),
    },
  ]);
}

describe('fetchActivity meta parsing', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it('returns the parsed meta with every field intact', async () => {
    stubActivity(META);

    const res = await fetchActivity({});

    expect(res.meta).toEqual(META);
    // Spot-check the values the stat tiles read — a schema that silently
    // stripped one of these would leave the tile rendering a placeholder.
    expect(res.meta?.stats.deleted).toBe(3);
    expect(res.meta?.stats.noisePreventedPerMonth).toBe(120);
    expect(res.meta?.allTimeStats.noisePreventedPerMonth).toBeNull();
    expect(res.meta?.pagination.nextCursor).toBe('cur-2');
    expect(res.meta?.verbs).toEqual(['archive', 'unsubscribe_confirmed']);
  });

  it('throws when the BE drops a stats field rather than reporting zero', async () => {
    const { deleted: _dropped, ...withoutDeleted } = STATS;
    stubActivity({ ...META, stats: withoutDeleted });

    await expect(fetchActivity({})).rejects.toThrow();
  });

  it('throws when a known field arrives with the wrong type', async () => {
    stubActivity({ ...META, stats: { ...STATS, archived: '4' } });

    await expect(fetchActivity({})).rejects.toThrow();
  });

  it('throws when the meta is missing entirely', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: /^\/api\/activity$/,
        respond: () => jsonOk({ data: [] }),
      },
    ]);

    await expect(fetchActivity({})).rejects.toThrow();
  });

  it('tolerates an unknown meta key so a BE deploy ahead of the web bundle still renders', async () => {
    stubActivity({ ...META, someFutureField: 'ignored' });

    const res = await fetchActivity({});

    expect(res.meta).toEqual(META);
  });
});
