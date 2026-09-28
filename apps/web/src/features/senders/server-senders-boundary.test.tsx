import { render, screen } from '@testing-library/react';
import { hashKey, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}));

import { sendersListPath } from '@/lib/api/senders';
import { makeQueryClient } from '@/lib/query-client';
import { DEFAULT_COMPOSE } from './filters';
import { sendersKeys } from './api/query-keys';
import {
  DEFAULT_SENDERS_QUERY,
  sendersListQueryFromScreen,
  sendersQueryFromSearchParams,
} from './api/query-options';
import { useSenders } from './api/use-senders';
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
  return <div>{senders.isSuccess ? 'Senders ready' : 'Senders loading'}</div>;
}

describe('ServerSendersBoundary', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('hydrates the default first page without duplicate client requests', async () => {
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
      if (url.endsWith('/api/me/settings')) {
        return Response.json({ data: { senderViews: [] } });
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
      'http://localhost:4000/api/senders?limit=50&sort=total&direction=desc&activity=active&current_mail_only=true',
      'http://localhost:4000/api/me/settings',
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
      '/api/senders?limit=50&sort=total&direction=desc&activity=active&current_mail_only=true',
    );
  });

  it('hashes an untrimmed ?q deep link to the same key the screen reads', () => {
    // The screen debounces `query.trim()`; the route parser must trim
    // before hashing or `?q=%20acme` hydrates a key no observer reads.
    const query = sendersQueryFromSearchParams({ q: ' acme ' });
    expect(query.q).toBe('acme');
    expect(hashKey(sendersKeys.list(query))).toEqual(
      hashKey(sendersKeys.list(sendersQueryFromSearchParams({ q: 'acme' }))),
    );
  });

  it('prefetches the same server-wide Inbox filter that the screen reads from a deep link', () => {
    const query = sendersQueryFromSearchParams({ has_inbox_mail: 'true' });
    expect(query.hasInboxMail).toBe(true);
    expect(sendersListPath(query)).toContain('has_inbox_mail=true');
  });

  it('hydrates the exact filtered deep-link list', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:4000');
    const query = sendersQueryFromSearchParams({ q: 'amazon.com', activity: 'all' });
    const fetchSpy = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/api/senders?')) {
        return Response.json({
          data: [],
          meta: {
            pagination: { nextCursor: null, hasMore: false },
            query: { globalMaxTotal: 0, totalMatching: 0, filterCounts: {}, asOf: 'now' },
          },
        });
      }
      if (url.endsWith('/api/me/settings')) {
        return Response.json({ data: { senderViews: [] } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchSpy);

    function FilteredProbe() {
      const list = useSenders(query);
      return <div>{list.isSuccess ? 'Filtered ready' : 'Filtered loading'}</div>;
    }

    const boundary = await ServerSendersBoundary({
      cookieHeader: 'dm_access=token',
      enabled: true,
      query,
      children: <FilteredProbe />,
    });
    render(<QueryClientProvider client={makeQueryClient()}>{boundary}</QueryClientProvider>);

    expect(screen.getByText('Filtered ready')).toBeInTheDocument();
    expect(fetchSpy.mock.calls.map(([input]) => String(input))).toEqual([
      'http://localhost:4000/api/senders?limit=50&sort=total&direction=desc&q=amazon.com&current_mail_only=true',
      'http://localhost:4000/api/me/settings',
    ]);
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
