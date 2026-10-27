import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { installFetchStub, jsonOk } from '@/test/fetch-stub';
import { createTestQueryClient } from '@/test/query-wrapper';
import { activityKeys } from '@/features/activity/api/query-keys';
import { useHomeOverview } from './use-home-overview';

function setup() {
  const client = createTestQueryClient();
  return {
    client,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}
function stub() {
  let count = 60;
  let hold: Promise<void> | null = null;
  const requests: Array<{ path: string; mailbox: string | null }> = [];
  installFetchStub([
    {
      method: 'GET',
      path: /inbox-snapshot$/,
      respond: async (req, url) => {
        requests.push({ path: url.pathname, mailbox: req.headers.get('X-Active-Mailbox-Id') });
        if (hold) await hold;
        return jsonOk({
          data: {
            asOf: '2026-10-25T20:00:00Z',
            inboxCount: count,
            unreadInboxCount: 30,
            receivedCount: 60,
            totalBytes: null,
            sizeKnownCount: 0,
          },
        });
      },
    },
    {
      method: 'GET',
      path: '/api/activity/summary',
      respond: () =>
        jsonOk({
          data: { since: null, decidedSenders: 0, emailsByVerb: { archive: 0, delete: 0 } },
        }),
    },
    { method: 'GET', path: '/api/activity', respond: () => jsonOk({ data: [] }) },
    {
      method: 'GET',
      path: '/api/autopilot/rules',
      respond: () => jsonOk({ data: [{ enabled: true, mode: 'active' }] }),
    },
    {
      method: 'GET',
      path: '/api/autopilot/sender-rules',
      respond: () =>
        jsonOk({
          data: [
            { enabled: true, mode: 'observe' },
            { enabled: false, mode: 'paused' },
          ],
        }),
    },
    {
      method: 'GET',
      path: '/api/autopilot/pending-suggestions',
      respond: () => jsonOk({ data: [{ id: 'one-page-row' }], meta: { total: 83 } }),
    },
    { method: 'GET', path: '/api/followups', respond: () => jsonOk({ data: [] }) },
    { method: 'GET', path: '/api/briefs/today', respond: () => jsonOk({ data: null }) },
  ]);
  return {
    requests,
    setCount: (value: number) => {
      count = value;
    },
    setHold: (value: Promise<void> | null) => {
      hold = value;
    },
  };
}

describe('Home overview reads', () => {
  it('uses the uncapped suggestion total, represents unknown size, and scopes every snapshot', async () => {
    const fixture = stub();
    const { result } = renderHook(() => useHomeOverview('mailbox-a', 'pro', true), setup());
    await waitFor(() => expect(result.current.suggestions.data).toBe(83));
    expect(result.current.snapshot.data?.totalBytes).toBeNull();
    await waitFor(() =>
      expect(result.current.rules.data).toEqual({ active: 1, watching: 1, paused: 1 }),
    );
    expect(fixture.requests).toEqual([
      { path: '/api/mailboxes/mailbox-a/inbox-snapshot', mailbox: 'mailbox-a' },
    ]);
  });
  it('refreshes on terminal Activity invalidation without holding its completion on an optional read', async () => {
    const fixture = stub();
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useHomeOverview('mailbox-a', 'pro', true), { wrapper });
    await waitFor(() => expect(result.current.snapshot.data?.inboxCount).toBe(60));
    let release!: () => void;
    fixture.setCount(12);
    fixture.setHold(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    await act(async () => {
      await client.invalidateQueries({ queryKey: activityKeys.all });
    });
    await waitFor(() => expect(fixture.requests).toHaveLength(2));
    expect(result.current.snapshot.data?.inboxCount).toBe(60);
    await act(async () => {
      release();
    });
    await waitFor(() => expect(result.current.snapshot.data?.inboxCount).toBe(12));
  });
  it('drops the previous mailbox totals while a switched mailbox is pending', async () => {
    const fixture = stub();
    const { result, rerender } = renderHook(({ id }) => useHomeOverview(id, 'pro', true), {
      ...setup(),
      initialProps: { id: 'mailbox-a' },
    });
    await waitFor(() => expect(result.current.snapshot.data?.inboxCount).toBe(60));
    let release!: () => void;
    fixture.setHold(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    rerender({ id: 'mailbox-b' });
    expect(result.current.snapshot.data).toBeNull();
    await act(async () => {
      release();
    });
    await waitFor(() => expect(fixture.requests.at(-1)?.mailbox).toBe('mailbox-b'));
  });
  it('does not read restricted workflows on Free or any source without an active mailbox', async () => {
    const fixture = stub();
    const { result, rerender } = renderHook(({ id }) => useHomeOverview(id, 'free', true), {
      ...setup(),
      initialProps: { id: null as string | null },
    });
    expect(fixture.requests).toHaveLength(0);
    rerender({ id: 'mailbox-a' });
    await waitFor(() => expect(result.current.snapshot.status).toBe('ready'));
    expect(result.current.rules.status).toBe('locked');
    expect(result.current.followups.status).toBe('locked');
  });
});
