import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useTodaySummary, useTriageQueue, useTriageStats } from './use-triage-queue';

/**
 * The Triage route's three reads must come from ONE request.
 *
 * When they were three queries, the Today strip could describe a queue that
 * was not the one rendered below it: each request derived its own 90-day
 * cutoff, each fetched its own copy of the rows, and four separate paths
 * invalidated them independently. The strip could say "12 sender decisions"
 * above 11 rows, or credit a subset that had changed since.
 */
vi.mock('@/lib/api/client', () => ({
  apiGet: vi.fn(),
}));

const { apiGet } = await import('@/lib/api/client');
const mockApiGet = vi.mocked(apiGet);

const BOOTSTRAP = {
  queue: [{ id: 'row-1' }],
  stats: { decidedToday: 3 },
  todaySummary: { queuedDecisions: 1, noiseSenderCount: 1, noiseReductionPct: 9 },
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => {
  mockApiGet.mockReset();
});

describe('the Triage reads share one cache entry', () => {
  it('fetches once for the queue, the stats and the Today strip', async () => {
    mockApiGet.mockResolvedValue({ data: BOOTSTRAP } as never);

    const { result } = renderHook(
      () => ({
        queue: useTriageQueue(),
        stats: useTriageStats(),
        summary: useTodaySummary(),
      }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.queue.data).toBeDefined());
    await waitFor(() => expect(result.current.summary.data).toBeDefined());

    // The load-bearing assertion. Three observers, ONE request — so the
    // strip's numbers are computed from the exact rows on screen.
    expect(mockApiGet).toHaveBeenCalledTimes(1);
    expect(mockApiGet).toHaveBeenCalledWith('/api/triage/bootstrap', expect.anything());

    expect(result.current.queue.data).toEqual(BOOTSTRAP.queue);
    expect(result.current.stats.data).toEqual(BOOTSTRAP.stats);
    expect(result.current.summary.data).toEqual(BOOTSTRAP.todaySummary);
  });

  it('never reads the retired per-surface endpoints', async () => {
    mockApiGet.mockResolvedValue({ data: BOOTSTRAP } as never);
    const { result } = renderHook(() => useTodaySummary(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());

    // `/today-summary` and `/stats` still exist server-side, but a client
    // that calls them is a client that can disagree with its own rows.
    const paths = mockApiGet.mock.calls.map((call) => call[0]);
    expect(paths).not.toContain('/api/triage/today-summary');
    expect(paths).not.toContain('/api/triage/stats');
    expect(paths).not.toContain('/api/triage/queue');
  });
});
