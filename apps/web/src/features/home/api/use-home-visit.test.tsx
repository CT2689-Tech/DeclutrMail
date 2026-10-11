import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useHomeVisit } from './use-home-visit';
const state = vi.hoisted(() => ({ mailbox: 'a', post: vi.fn() }));
vi.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({
    me: {
      user: { id: 'user' },
      activeMailboxId: state.mailbox,
      mailboxes: ['a', 'b'].map((id) => ({ id, readiness: 'ready' })),
    },
  }),
}));
vi.mock('@/lib/api/client', () => ({ apiPost: state.post }));
function Probe() {
  const result = useHomeVisit();
  return <p>{result.data?.visitId}</p>;
}
const key = 'declutrmail:visit:user:a';
const savedId = '10000000-0000-4000-8000-000000000001';
let now: number;
beforeEach(() => {
  state.mailbox = 'a';
  state.post.mockReset();
  localStorage.clear();
  now = Date.parse('2026-10-10T10:00:00Z');
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  state.post.mockImplementation(async (_path, body) => ({
    data: {
      ...body,
      since: null,
      until: new Date(now).toISOString(),
      indexedEmails: null,
      indexedSenders: null,
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
describe('device visit lifecycle', () => {
  it('retains a recent visit across reload and generates a new id after idle in the same mounted tab', async () => {
    localStorage.setItem(key, JSON.stringify({ id: savedId, lastActive: now - 1000 }));
    mount();
    await waitFor(() =>
      expect(state.post).toHaveBeenCalledWith(
        '/api/home/visit',
        { visitId: savedId },
        expect.objectContaining({ mailboxId: 'a' }),
      ),
    );
    now += 31 * 60_000;
    fireEvent.focus(window);
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
    await waitFor(() => expect(state.post).toHaveBeenCalledTimes(1));
    const firstId = state.post.mock.calls[0]![1].visitId;
    first.unmount();
    mount();
    await waitFor(() => expect(state.post).toHaveBeenCalledTimes(2));
    expect(state.post.mock.calls[1]![1].visitId).toBe(firstId);
  });
});
