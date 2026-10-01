import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ cookie: 'dm_access=synthetic' }),
}));

import { ServerQueryHydration } from '@/lib/server-query-hydration';
import SettingsPage from './settings/page';
import QuietPage from './quiet/page';
import ActivityPage from './activity/page';
import AutopilotPage from './autopilot/page';
import BriefPage from './brief/page';

const me = {
  activeMailboxId: 'mb-primary',
  tier: 'pro',
  mailboxes: [
    { id: 'mb-primary', status: 'active' },
    { id: 'mb-secondary', status: 'active' },
  ],
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('screen dependencies', () => {
  it('hydrates the designed Brief absence without a second read', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:4000');
    const fetchSpy = vi.fn(async (input: string | URL | Request) => {
      if (new URL(String(input)).pathname === '/api/briefs/today') {
        return Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404 });
      }
      return Response.json({ data: me });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const page = await BriefPage();
    const hydrated = await ServerQueryHydration(page.props);
    expect(hydrated.props.state?.queries).toHaveLength(1);
    expect(hydrated.props.state?.queries[0]?.state.data).toEqual({ data: null });
    expect(
      fetchSpy.mock.calls.filter(
        ([input]) => new URL(String(input)).pathname === '/api/briefs/today',
      ),
    ).toHaveLength(1);
  });

  it.each([401, 403, 500])('does not turn a Brief %s into an empty edition', async (status) => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:4000');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) =>
        new URL(String(input)).pathname === '/api/briefs/today'
          ? Response.json({ error: { code: 'FAILURE' } }, { status })
          : Response.json({ data: me }),
      ),
    );
    const page = await BriefPage();
    const hydrated = await ServerQueryHydration(page.props);
    expect(hydrated.props.state?.queries).toHaveLength(0);
  });

  it.each([
    ['Autopilot pending suggestions', AutopilotPage, '/api/autopilot/pending-suggestions'],
    ['Autopilot pattern suggestions', AutopilotPage, '/api/autopilot/pattern-suggestion'],
    ['Settings billing', SettingsPage, '/api/billing/subscription'],
    ['Settings secondary mailbox health', SettingsPage, '/api/v1/sync/status'],
    ['Quiet secondary mailbox', QuietPage, '/api/mailboxes/mb-secondary/quiet-hours'],
    [
      'Activity weekly review',
      () => ActivityPage({ searchParams: Promise.resolve({}) }),
      '/api/activity/weekly-review',
    ],
  ] as const)('renders primary content without waiting for %s', async (_name, route, slowPath) => {
    vi.useFakeTimers();
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:4000');
    const fetchSpy = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (path === slowPath) await new Promise((resolve) => setTimeout(resolve, 1_500));
      return Response.json({
        data: path === '/api/auth/me' ? me : path === '/api/activity' ? [] : {},
        meta: {
          pagination: { nextCursor: null, hasMore: false, limit: 25 },
          stats: {
            archived: 0,
            unsubscribed: 0,
            kept: 0,
            later: 0,
            deleted: 0,
            followupsDismissed: 0,
            needsAttention: 0,
            noisePreventedPerMonth: null,
          },
          allTimeStats: {
            archived: 0,
            unsubscribed: 0,
            kept: 0,
            later: 0,
            deleted: 0,
            followupsDismissed: 0,
            needsAttention: 0,
            noisePreventedPerMonth: null,
          },
          window: '30d',
          source: 'all',
          senderQuery: '',
          dateFrom: null,
          dateTo: null,
        },
      });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const page = await route();
    let ready = false;
    const render = ServerQueryHydration(page.props).then((result) => {
      ready = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(ready).toBe(true);
    expect(fetchSpy.mock.calls.map(([input]) => new URL(String(input)).pathname)).not.toContain(
      slowPath,
    );
    await vi.advanceTimersByTimeAsync(1_500);
    expect((await render).props.state?.queries.length).toBeGreaterThan(0);
  });
});
