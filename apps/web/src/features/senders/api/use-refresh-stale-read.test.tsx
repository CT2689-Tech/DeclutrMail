import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';
import { useRefreshStaleRead } from './use-refresh-stale-read';

/**
 * Nothing in production revisits a sender's read: `sync_complete` scores
 * once at initial sync, `signal_change` fires only for a first-seen
 * sender, `manual_rescore` needs a human, and the documented weekly
 * `cron_sweep` has no producer. Opening a sender is therefore the moment
 * to refresh — and only when the read has actually aged out, or never
 * existed. Founder decision 2026-08-19.
 */
function Harness({
  senderId,
  read,
}: {
  senderId: string;
  read: { stale?: boolean } | null | undefined;
}) {
  useRefreshStaleRead(senderId, read, { settleMs: 5, invalidate: ['senders', 'detail', senderId] });
  return null;
}

function renderHook(props: { senderId: string; read: { stale?: boolean } | null | undefined }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<Harness {...props} />, { wrapper });
}

let posted: Array<Record<string, unknown>>;

beforeEach(() => {
  posted = [];
  window.sessionStorage.clear();
  installFetchStub([
    {
      method: 'POST',
      path: '/api/triage/score-sender',
      respond: async (req: Request) => {
        posted.push((await req.json()) as Record<string, unknown>);
        return jsonOk({ data: { idempotencyKey: 'k' } });
      },
    },
  ]);
});

afterEach(() => {
  resetFetchStub();
  vi.restoreAllMocks();
});

describe('useRefreshStaleRead', () => {
  it('asks for a fresh read when the stored one has aged out', async () => {
    renderHook({ senderId: 's-1', read: { stale: true } });
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({ senderId: 's-1', reason: 'stale' });
  });

  it('asks when the engine has never scored the sender', async () => {
    renderHook({ senderId: 's-2', read: null });
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ senderId: 's-2' });
  });

  it('leaves a fresh read alone', async () => {
    renderHook({ senderId: 's-3', read: { stale: false } });
    await new Promise((r) => setTimeout(r, 30));
    expect(posted).toHaveLength(0);
  });

  it('does not fire before the read has loaded', async () => {
    renderHook({ senderId: 's-4', read: undefined });
    await new Promise((r) => setTimeout(r, 30));
    expect(posted).toHaveLength(0);
  });

  it('asks once per sender however often it re-renders', async () => {
    const { rerender } = renderHook({ senderId: 's-5', read: { stale: true } });
    await waitFor(() => expect(posted).toHaveLength(1));
    rerender(<Harness senderId="s-5" read={{ stale: true }} />);
    rerender(<Harness senderId="s-5" read={{ stale: true }} />);
    await new Promise((r) => setTimeout(r, 30));
    expect(posted).toHaveLength(1);
  });

  it('does not ask again after a reload while the first refresh is still in flight', async () => {
    const first = renderHook({ senderId: 's-7', read: { stale: true } });
    await waitFor(() => expect(posted).toHaveLength(1));
    first.unmount();

    // A reload is a fresh mount with a fresh ref — sessionStorage is
    // what remembers, and the row is still stale until the worker lands.
    renderHook({ senderId: 's-7', read: { stale: true } });
    await new Promise((r) => setTimeout(r, 30));
    expect(posted).toHaveLength(1);
  });

  it('stays silent when the request fails — a stale read still renders', async () => {
    installFetchStub([
      {
        method: 'POST',
        path: '/api/triage/score-sender',
        respond: () =>
          new Response(JSON.stringify({ error: { code: 'RATE_LIMITED' } }), {
            status: 429,
            headers: { 'content-type': 'application/json' },
          }),
      },
    ]);
    const onError = vi.fn();
    window.addEventListener('unhandledrejection', onError);
    expect(() => renderHook({ senderId: 's-6', read: { stale: true } })).not.toThrow();
    await new Promise((r) => setTimeout(r, 30));
    expect(onError).not.toHaveBeenCalled();
    window.removeEventListener('unhandledrejection', onError);
  });
});
