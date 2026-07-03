/**
 * Tests for the expanded-row detail panel's volume chart.
 *
 * The chart previously rendered a seeded pseudo-random series (a §10
 * "no fake completion" violation); it now renders the sender's real
 * `sender_timeseries` months. Covers:
 *
 *   • Presentational states (D211): loading skeleton, error + retry,
 *     empty ("No volume history yet"), ready (one bar per month row,
 *     peak label, month-range footer).
 *   • `SenderRowDetailLive`: fetches `/api/senders/:id/timeseries` on
 *     mount (= on expand) and maps the envelope into the states above;
 *     a 4xx becomes the error state without retry storms
 *     (`retryUnless4xx`), and Retry refetches.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { installFetchStub, jsonNotFound, jsonOk } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import type { Sender } from '../data';
import {
  SenderRowDetail,
  SenderRowDetailLive,
  type RowDetailTimeseries,
} from './sender-row-detail';

function sender(overrides: Partial<Sender> = {}): Sender {
  return {
    id: 'sender-1',
    name: 'Acme Newsletter',
    domain: 'acme.com',
    monthly: 12,
    group: 'updates',
    read: 0.2,
    spark: [3, 3, 3, 3],
    lastDays: 4,
    unread: 0,
    firstSeenMo: 18,
    volumeTrend: 'steady',
    lastReview: null,
    ...overrides,
  };
}

const TIMESERIES = [
  { yearMonth: '2026-05-01', volume: 8, readCount: 2 },
  { yearMonth: '2026-06-01', volume: 20, readCount: 1 },
  { yearMonth: '2026-07-01', volume: 5, readCount: 0 },
];

function renderDetail(timeseries: RowDetailTimeseries) {
  return render(<SenderRowDetail s={sender()} onAction={() => {}} timeseries={timeseries} />);
}

describe('SenderRowDetail volume chart', () => {
  it('ready: renders one bar per timeseries month with real peak + month-range labels', () => {
    renderDetail({ status: 'ready', points: TIMESERIES });
    const chart = screen.getByRole('img', {
      name: /monthly volume over 3 months, peak 20 per month/i,
    });
    expect(chart.children.length).toBe(3);
    // Peak bar is full height; others proportional to REAL volumes.
    const heights = Array.from(chart.children).map((el) => (el as HTMLElement).style.height);
    expect(heights[1]).toBe('100%');
    expect(heights[0]).toBe('40%'); // 8/20
    expect(screen.getByText(/peak 20\/mo/i)).toBeTruthy();
    expect(screen.getByText('May 2026')).toBeTruthy();
    expect(screen.getByText('Jul 2026')).toBeTruthy();
  });

  it('ready + no rows: renders the calm empty state, no bars, no peak', () => {
    renderDetail({ status: 'ready', points: [] });
    expect(screen.getByText(/no volume history yet/i)).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByText(/peak/i)).toBeNull();
  });

  it('loading: marks the card busy and shows the skeleton, no data claims', () => {
    const { container } = renderDetail({ status: 'loading' });
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByText(/peak/i)).toBeNull();
  });

  it('error: shows the error copy and wires the Retry button', () => {
    const retry = vi.fn();
    renderDetail({ status: 'error', retry });
    expect(screen.getByText(/couldn't load volume history/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe('SenderRowDetailLive', () => {
  function renderLive() {
    const client = createTestQueryClient();
    return render(
      <QueryWrapper client={client}>
        <SenderRowDetailLive s={sender()} onAction={() => {}} />
      </QueryWrapper>,
    );
  }

  it('fetches the sender timeseries on mount and renders the real bars', async () => {
    const requested: string[] = [];
    installFetchStub([
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+\/timeseries$/,
        respond: (_req, url) => {
          requested.push(url.pathname);
          return jsonOk({ data: TIMESERIES });
        },
      },
    ]);
    renderLive();
    const chart = await screen.findByRole('img', { name: /peak 20 per month/i });
    expect(chart.children.length).toBe(3);
    expect(requested).toEqual(['/api/senders/sender-1/timeseries']);
  });

  it('maps a 4xx to the error state (no retry storm) and Retry refetches', async () => {
    let fail = true;
    installFetchStub([
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+\/timeseries$/,
        respond: () => (fail ? jsonNotFound('sender_not_found') : jsonOk({ data: TIMESERIES })),
      },
    ]);
    renderLive();
    expect(await screen.findByText(/couldn't load volume history/i)).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByRole('img', { name: /peak 20 per month/i })).toBeTruthy();
  });
});
