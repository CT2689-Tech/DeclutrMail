// @vitest-environment node
import { renderToString } from 'react-dom/server';
import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./sentry', () => ({ captureFeatureException: vi.fn() }));
vi.mock('./entitlements/upgrade-gate', () => ({ reportUpgradeGateHit: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

import { makeQueryClient } from './query-client';
import { ServerQueryHydration } from './server-query-hydration';
import { usePendingSuggestions } from '@/features/autopilot/api/use-pending-suggestions';

describe('streamed query recovery during Client Component SSR', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('observes a late failure even when an abandoned render never consumes its snapshot', async () => {
    vi.useFakeTimers();
    const unhandled: unknown[] = [];
    const observe = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', observe);
    try {
      const boundary = await ServerQueryHydration({
        surface: 'autopilot',
        prefetch: () => [],
        streamPrefetch: (client) => [
          client.fetchQuery({
            queryKey: ['autopilot', 'pending-suggestions'],
            queryFn: () =>
              new Promise((_resolve, reject) =>
                setTimeout(() => reject(new Error('private failure')), 100),
              ),
          }),
        ],
        children: <p>Rules</p>,
      });
      expect(boundary.props.state.queries[0]?.state.status).toBe('pending');
      // Deliberately do not attach a Flight or browser promise consumer.
      await vi.advanceTimersByTimeAsync(200);
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', observe);
    }
  });

  it.each([100, 2_000])(
    'does not call browser API or refresh after a late rejection at %i ms',
    async (delay) => {
      vi.useFakeTimers();
      const server = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const client = makeQueryClient();
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      const mailboxId = '00000000-0000-4000-8000-000000000001';
      const queryKey = ['autopilot', 'pending-suggestions', 'page', mailboxId, null];
      void server
        .fetchQuery({
          queryKey,
          queryFn: () =>
            new Promise((_resolve, reject) =>
              setTimeout(() => reject(new Error('private server failure')), delay),
            ),
        })
        .catch(() => undefined);
      const state = dehydrate(server, { shouldDehydrateQuery: () => true });
      function Probe() {
        const pending = usePendingSuggestions(mailboxId);
        return <p>{pending.isPending ? 'Review loading' : 'Review ready'}</p>;
      }
      const html = renderToString(
        <QueryClientProvider client={client}>
          <HydrationBoundary state={state}>
            <Probe />
          </HydrationBoundary>
        </QueryClientProvider>,
      );
      expect(html).toContain('Review loading');
      expect(client.getDefaultOptions().queries?.retry).toBe(false);
      await vi.advanceTimersByTimeAsync(delay + 1_100);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(client.getQueryState(queryKey)?.status).toBe('error');
      client.clear();
      server.clear();
    },
  );

  it('adopts a successful stream during SSR without a browser reader', async () => {
    const server = new QueryClient();
    const client = makeQueryClient();
    const reader = vi.fn();
    let resolve!: (value: string) => void;
    void server.fetchQuery({
      queryKey: ['stream'],
      queryFn: () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    });
    const state = dehydrate(server, { shouldDehydrateQuery: () => true });
    function Probe() {
      const result = useQuery({ queryKey: ['stream'], queryFn: reader });
      return <p>{result.isPending ? 'Loading' : 'Ready'}</p>;
    }
    expect(
      renderToString(
        <QueryClientProvider client={client}>
          <HydrationBoundary state={state}>
            <Probe />
          </HydrationBoundary>
        </QueryClientProvider>,
      ),
    ).toContain('Loading');
    resolve('complete');
    await client.getQueryCache().find({ queryKey: ['stream'] })?.promise;
    expect(client.getQueryData(['stream'])).toBe('complete');
    expect(reader).not.toHaveBeenCalled();
    client.clear();
    server.clear();
  });
});
