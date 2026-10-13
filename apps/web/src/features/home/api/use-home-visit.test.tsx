import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { act, render, fireEvent, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HomeArrivalsView } from '../home-arrivals';
import { useHomeVisit } from './use-home-visit';
const state = vi.hoisted(() => {
  class ApiError extends Error {
    readonly status: number;
    readonly body: unknown;
    constructor(status: number, body: unknown, message: string) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.body = body;
    }
  }
  return { mailbox: 'a', post: vi.fn(), get: vi.fn(), ApiError };
});
vi.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({
    me: {
      user: { id: 'user' },
      activeMailboxId: state.mailbox,
      mailboxes: ['a', 'b'].map((id) => ({ id, readiness: 'ready' })),
    },
  }),
}));
vi.mock('@/lib/api/client', () => ({
  apiPost: state.post,
  apiGet: state.get,
  ApiError: state.ApiError,
}));
function Probe() {
  const result = useHomeVisit();
  return <p>{result.data?.visitId}</p>;
}
function VisitRead() {
  const result = useHomeVisit();
  return (
    <>
      <p>{result.isPending ? 'pending' : result.isError ? 'visit-error' : 'visit-ready'}</p>
      <HomeArrivalsView
        data={result.data}
        error={result.isError}
        retry={() => void result.refetch()}
      />
    </>
  );
}
const key = 'declutrmail:visit:user:a';
const savedId = '10000000-0000-4000-8000-000000000001';
let now: number;
beforeEach(() => {
  state.mailbox = 'a';
  state.post.mockReset();
  state.get.mockReset();
  localStorage.clear();
  now = Date.parse('2026-10-10T10:00:00Z');
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const window = {
    visitId: savedId,
    since: null,
    until: new Date(now).toISOString(),
    indexedEmails: null,
    indexedSenders: null,
  };
  state.get.mockResolvedValue({ data: window });
  state.post.mockImplementation(async (_path, body) => ({
    data: {
      ...window,
      ...body,
    },
  }));
});
afterEach(() => vi.restoreAllMocks());
function mount() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Probe />
    </QueryClientProvider>,
  );
}
async function paint() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  });
}
describe('device visit lifecycle', () => {
  it('reads the visit peek first and records after paint', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    localStorage.setItem(key, JSON.stringify({ id: savedId, lastActive: now - 1000 }));
    mount();
    await waitFor(() =>
      expect(state.get).toHaveBeenCalledWith(
        `/api/home/visit?visitId=${savedId}`,
        expect.objectContaining({ mailboxId: 'a' }),
      ),
    );
    expect(state.post).not.toHaveBeenCalled();
    await act(async () => {
      for (const callback of frames) callback(0);
    });
    await waitFor(() =>
      expect(state.post).toHaveBeenCalledWith(
        '/api/home/visit',
        { visitId: savedId },
        expect.objectContaining({ mailboxId: 'a' }),
      ),
    );
    expect(state.get.mock.invocationCallOrder[0]!).toBeLessThan(
      state.post.mock.invocationCallOrder[0]!,
    );
  });

  it('retains a recent visit across reload and generates a new id after idle in the same mounted tab', async () => {
    localStorage.setItem(key, JSON.stringify({ id: savedId, lastActive: now - 1000 }));
    mount();
    await paint();
    await waitFor(() =>
      expect(state.post).toHaveBeenCalledWith(
        '/api/home/visit',
        { visitId: savedId },
        expect.objectContaining({ mailboxId: 'a' }),
      ),
    );
    now += 31 * 60_000;
    fireEvent.focus(window);
    await paint();
    await waitFor(() => expect(state.post).toHaveBeenCalledTimes(2));
    const next = state.post.mock.calls[1]![1].visitId;
    expect(next).not.toBe(savedId);
    expect(JSON.parse(localStorage.getItem(key)!).id).toBe(next);
  });
  it('scopes the visit to its mailbox and shares a fallback when storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    const first = mount();
    await paint();
    await waitFor(() => expect(state.post).toHaveBeenCalledTimes(1));
    const firstId = state.post.mock.calls[0]![1].visitId;
    first.unmount();
    mount();
    await paint();
    await waitFor(() => expect(state.post).toHaveBeenCalledTimes(2));
    expect(state.post.mock.calls[1]![1].visitId).toBe(firstId);
  });

  it('does not open a new visit while the tab is hidden', async () => {
    localStorage.setItem(key, JSON.stringify({ id: savedId, lastActive: now - 1000 }));
    const originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    const ticks: Array<() => void> = [];
    const interval = vi.spyOn(window, 'setInterval').mockImplementation((handler) => {
      ticks.push(handler as () => void);
      return 1 as unknown as ReturnType<typeof setInterval>;
    });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    try {
      mount();
      await paint();
      await waitFor(() => expect(state.post).toHaveBeenCalledTimes(1));
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      now += 31 * 60_000;
      act(() => {
        for (const tick of ticks) tick();
      });
      expect(state.post).toHaveBeenCalledTimes(1);

      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
      await paint();
      await waitFor(() => expect(state.post).toHaveBeenCalledTimes(2));
    } finally {
      interval.mockRestore();
      if (originalVisibility)
        Object.defineProperty(document, 'visibilityState', originalVisibility);
    }
  });

  it('treats a missing visit as quiet and records it instead of showing a load error', async () => {
    localStorage.setItem(key, JSON.stringify({ id: savedId, lastActive: now - 1000 }));
    state.get.mockRejectedValue(
      new state.ApiError(404, { error: { code: 'NOT_FOUND' } }, 'GET /api/home/visit failed: 404'),
    );
    state.post.mockResolvedValue({
      data: {
        visitId: savedId,
        since: '2026-10-09T10:00:00.000Z',
        until: '2026-10-10T10:00:00.000Z',
        indexedEmails: 0,
        indexedSenders: 0,
      },
    });
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <VisitRead />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText('visit-ready')).toBeInTheDocument());
    expect(screen.queryByText(/load changes since your visit/i)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'No new email since your last visit.' }),
      ).toBeInTheDocument(),
    );
    expect(state.post).toHaveBeenCalledWith(
      '/api/home/visit',
      { visitId: savedId },
      expect.objectContaining({ mailboxId: 'a' }),
    );
  });

  it('still shows the load error when the visit read fails for another reason', async () => {
    localStorage.setItem(key, JSON.stringify({ id: savedId, lastActive: now - 1000 }));
    state.get.mockRejectedValue(
      new state.ApiError(500, { error: { code: 'INTERNAL' } }, 'GET /api/home/visit failed: 500'),
    );
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <VisitRead />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText('visit-error')).toBeInTheDocument());
    expect(screen.getByText(/load changes since your visit/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
