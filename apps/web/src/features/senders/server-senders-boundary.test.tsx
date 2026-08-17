import { render, screen } from '@testing-library/react';
import { hashKey, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}));

import { sendersListPath } from '@/lib/api/senders';
import { makeQueryClient } from '@/lib/query-client';
import { DEFAULT_COMPOSE } from './compose-strip';
import { sendersKeys } from './api/query-keys';
import {
  DEFAULT_SENDERS_QUERY,
  sendersListQueryFromScreen,
  shouldHydrateDefaultSenders,
  shouldPrefetchSenders,
} from './api/query-options';
import { useSenders } from './api/use-senders';
import { useSendersSummary } from './api/use-senders-summary';
import { ServerSendersBoundary } from './server-senders-boundary';

function SendersScreenProbe() {
  // Same hook args the live screen uses on a bare `/senders` URL.
  const senders = useSenders(
    sendersListQueryFromScreen({
      compose: DEFAULT_COMPOSE,
      sort: 'total',
      direction: 'desc',
      q: '',
    }),
  );
  const summary = useSendersSummary({ q: '' });
  return <div>{senders.isSuccess && summary.isSuccess ? 'Senders ready' : 'Senders loading'}</div>;
}

describe('ServerSendersBoundary', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('hydrates the default first page and summary without duplicate client requests', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:4000');
    const fetchSpy = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/api/senders?')) {
        return Response.json({
          data: [],
          meta: {
            pagination: { nextCursor: null, hasMore: false },
            query: {
              globalMaxTotal: 0,
              totalMatching: 0,
              filterCounts: {},
              asOf: '2026-08-16T00:00:00.000Z',
            },
          },
        });
      }
      if (url.endsWith('/api/senders/summary')) {
        return Response.json({ data: { totalSenders: 0 } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchSpy);

    const boundary = await ServerSendersBoundary({
      cookieHeader: 'dm_access=token',
      enabled: true,
      children: <SendersScreenProbe />,
    });
    render(<QueryClientProvider client={makeQueryClient()}>{boundary}</QueryClientProvider>);

    expect(screen.getByText('Senders ready')).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls.map(([input]) => String(input))).toEqual([
      'http://localhost:4000/api/senders?limit=50&sort=total&direction=desc&activity=active',
      'http://localhost:4000/api/senders/summary',
    ]);
  });

  it('does not fetch mailbox data when there is no active mailbox', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const boundary = await ServerSendersBoundary({
      cookieHeader: '',
      enabled: false,
      children: <div>Reconnect required</div>,
    });
    render(<QueryClientProvider client={makeQueryClient()}>{boundary}</QueryClientProvider>);

    expect(screen.getByText('Reconnect required')).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('hydrates the default list even when the URL carries ignored or redundant keys', () => {
    expect(shouldHydrateDefaultSenders({})).toBe(true);
    expect(shouldHydrateDefaultSenders({ utm_source: 'newsletter' })).toBe(true);
    expect(shouldHydrateDefaultSenders({ activity: 'active' })).toBe(true);
    expect(shouldHydrateDefaultSenders({ q: '' })).toBe(true);
    expect(shouldHydrateDefaultSenders({ get: 'campaign-tag' })).toBe(true);
    expect(shouldHydrateDefaultSenders(new URLSearchParams('utm_source=newsletter'))).toBe(true);
    expect(shouldHydrateDefaultSenders({ q: 'amazon.com' })).toBe(false);
    expect(shouldHydrateDefaultSenders({ activity: 'all' })).toBe(false);
  });

  it('prefetches only when a mailbox is active and the URL is the default list', () => {
    const me = { activeMailboxId: 'mailbox-1' };
    expect(shouldPrefetchSenders(me, {})).toBe(true);
    expect(shouldPrefetchSenders(me, { utm_source: 'newsletter' })).toBe(true);
    expect(shouldPrefetchSenders(null, {})).toBe(false);
    expect(shouldPrefetchSenders({ activeMailboxId: null }, {})).toBe(false);
    expect(shouldPrefetchSenders(me, { q: 'amazon.com' })).toBe(false);
  });

  it('hydrates the same list key the Senders screen reads on a bare URL', () => {
    expect(hashKey(sendersKeys.list(DEFAULT_SENDERS_QUERY))).toEqual(
      hashKey(
        sendersKeys.list(
          sendersListQueryFromScreen({
            compose: DEFAULT_COMPOSE,
            sort: 'total',
            direction: 'desc',
            q: '',
          }),
        ),
      ),
    );
    expect(hashKey(sendersKeys.list({ limit: 50 }))).not.toEqual(
      hashKey(sendersKeys.list(DEFAULT_SENDERS_QUERY)),
    );
    expect(sendersListPath(DEFAULT_SENDERS_QUERY)).toBe(
      '/api/senders?limit=50&sort=total&direction=desc&activity=active',
    );
  });

  it('hydrates the nav-chip query from the same default list the screen reads', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:4000');
    const fetchSpy = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/api/senders?')) {
        return Response.json({
          data: [],
          meta: {
            pagination: { nextCursor: null, hasMore: false },
            query: {
              globalMaxTotal: 0,
              totalMatching: 0,
              filterCounts: {},
              asOf: '2026-08-16T00:00:00.000Z',
            },
          },
        });
      }
      if (url.endsWith('/api/senders/summary')) {
        return Response.json({ data: { totalSenders: 0 } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchSpy);

    function ScreenAndChipProbe() {
      const senders = useSenders(
        sendersListQueryFromScreen({
          compose: DEFAULT_COMPOSE,
          sort: 'total',
          direction: 'desc',
          q: '',
        }),
      );
      const chip = useSenders({ ...DEFAULT_SENDERS_QUERY });
      return (
        <div>
          {senders.isSuccess && chip.isSuccess ? 'Senders and chip ready' : 'Senders loading'}
        </div>
      );
    }

    const boundary = await ServerSendersBoundary({
      cookieHeader: 'dm_access=token',
      enabled: true,
      children: <ScreenAndChipProbe />,
    });
    render(<QueryClientProvider client={makeQueryClient()}>{boundary}</QueryClientProvider>);

    expect(screen.getByText('Senders and chip ready')).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('does not retry designed 4xx states during server prefetch', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:4000');
    const fetchSpy = vi.fn(async () =>
      Response.json(
        { error: { code: 'NO_ACTIVE_MAILBOX', message: 'Select a mailbox' } },
        { status: 409 },
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await ServerSendersBoundary({
      cookieHeader: 'dm_access=token',
      enabled: true,
      children: <div>Fallback</div>,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
