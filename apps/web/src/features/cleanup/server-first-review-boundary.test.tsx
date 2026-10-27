import { render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));
vi.mock('@/features/auth/api/server-me', () => ({ getServerMe: vi.fn() }));

import { getServerMe } from '@/features/auth/api/server-me';
import type { Me } from '@/features/auth/api/me-contract';
import { useScreenerQueue } from '@/features/screener/api/use-screener';
import { makeQueryClient } from '@/lib/query-client';
import { ServerFirstReviewBoundary } from './server-first-review-boundary';

function QueueProbe() {
  const query = useScreenerQueue();
  return <div>{query.isSuccess ? `Ready: ${query.data.length}` : 'Loading'}</div>;
}

const me = (tier: Me['tier'], activeMailboxId: string | null = 'synthetic-mailbox') =>
  ({ tier, activeMailboxId }) as Me;

describe('first review server hydration', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each([
    ['inactive view', false, me('pro')],
    ['Free workspace', true, me('free')],
    ['no mailbox', true, me('pro', null)],
    ['signed out', true, null],
  ] as const)('does not read the queue for %s', async (_name, enabled, session) => {
    vi.mocked(getServerMe).mockResolvedValue(session);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const boundary = await ServerFirstReviewBoundary({
      cookieHeader: 'dm_access=synthetic',
      enabled,
      children: <div>First review</div>,
    });
    render(<QueryClientProvider client={makeQueryClient()}>{boundary}</QueryClientProvider>);
    expect(screen.getByText('First review')).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getServerMe).toHaveBeenCalledTimes(enabled ? 1 : 0);
  });

  it('hydrates an entitled mailbox without a duplicate client queue request', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:4000');
    vi.mocked(getServerMe).mockResolvedValue(me('pro'));
    const fetchSpy = vi.fn<typeof fetch>(async () => Response.json({ data: [] }));
    vi.stubGlobal('fetch', fetchSpy);
    const boundary = await ServerFirstReviewBoundary({
      cookieHeader: 'dm_access=synthetic',
      enabled: true,
      children: <QueueProbe />,
    });
    render(<QueryClientProvider client={makeQueryClient()}>{boundary}</QueryClientProvider>);
    expect(screen.getByText('Ready: 0')).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toContain('/api/screener/queue');
    const request = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(new Headers(request?.headers).get('X-Active-Mailbox-Id')).toBe('synthetic-mailbox');
  });
});
