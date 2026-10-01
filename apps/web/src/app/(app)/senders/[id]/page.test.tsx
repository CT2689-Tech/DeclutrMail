import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ cookie: 'dm_access=synthetic' }),
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));

import { ServerQueryHydration } from '@/lib/server-query-hydration';
import SenderDetailPage from './page';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('sender detail route readiness', () => {
  it.each([401, 404, 409])(
    'preserves the guarded %s fallback without secondary server reads',
    async (status) => {
      vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:4000');
      const fetchSpy = vi.fn(async () =>
        Response.json({ error: { code: 'UNAVAILABLE' } }, { status }),
      );
      vi.stubGlobal('fetch', fetchSpy);
      const page = await SenderDetailPage({ params: Promise.resolve({ id: 'synthetic' }) });
      const boundary = await ServerQueryHydration(page.props);
      expect(boundary.props.state?.queries).toHaveLength(0);
      expect(fetchSpy).toHaveBeenCalledOnce();
    },
  );

  it.each(['messages', 'timeseries', 'history'])(
    'does not hold primary detail behind slow %s',
    async (slowResource) => {
      vi.useFakeTimers();
      vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:4000');
      const fetchSpy = vi.fn(async (input: string | URL | Request) => {
        const path = new URL(String(input)).pathname;
        if (path === '/api/auth/me') {
          return Response.json({ data: { activeMailboxId: 'mb-synthetic' } });
        }
        if (path.endsWith(`/${slowResource}`)) {
          await new Promise((resolve) => setTimeout(resolve, 1_500));
        }
        return Response.json({
          data: path === '/api/senders/synthetic' ? { id: 'synthetic', inboxCount: 7 } : [],
          meta: { pagination: { hasMore: false, nextCursor: null } },
        });
      });
      vi.stubGlobal('fetch', fetchSpy);
      const page = await SenderDetailPage({ params: Promise.resolve({ id: 'synthetic' }) });
      let ready = false;
      const render = ServerQueryHydration(page.props).then((boundary) => {
        ready = true;
        return boundary;
      });
      await vi.advanceTimersByTimeAsync(0);
      // This is the real server prefetch boundary, before browser hydration.
      expect(ready).toBe(true);
      const boundary = await render;
      expect(boundary.props.state?.queries).toHaveLength(1);
      expect(boundary.props.state?.queries[0]?.state.data).toMatchObject({
        data: { id: 'synthetic', inboxCount: 7 },
      });
      expect(fetchSpy.mock.calls.map(([input]) => new URL(String(input)).pathname)).toEqual([
        '/api/senders/synthetic',
      ]);
    },
  );
});
