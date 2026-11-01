import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckoutAttempt } from '@declutrmail/shared/contracts';
import { apiPost } from '@/lib/api/client';
import { launchCheckout } from './checkout';
import { CheckoutAttemptNotice } from './checkout-attempt-notice';
vi.mock('@/lib/api/client', () => ({ apiPost: vi.fn() }));
vi.mock('./checkout', () => ({ launchCheckout: vi.fn() }));
const attempt: CheckoutAttempt = {
  id: '11111111-1111-4111-8111-111111111111',
  version: 2,
  state: 'open',
  tier: 'plus',
  cycle: 'annual',
  offer: 'pass_onetime',
  createdAt: new Date().toISOString(),
  canResume: true,
  canCancel: true,
};
beforeEach(() => {
  vi.mocked(apiPost)
    .mockReset()
    .mockResolvedValue({ data: { outcome: 'payment_in_progress', attempt } } as never);
  vi.mocked(launchCheckout).mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());
describe('server-owned checkout recovery controls', () => {
  it('names the purchase and checks its exact identity automatically', async () => {
    const updated = vi.fn();
    render(<CheckoutAttemptNotice attempt={attempt} ownerId="w" onUpdated={updated} />);
    expect(screen.getByText(/Backlog Pass checkout is still open/)).toBeInTheDocument();
    await waitFor(() => expect(updated).toHaveBeenCalled());
    expect(apiPost).toHaveBeenCalledWith(
      '/api/billing/reconcile',
      { attemptId: attempt.id },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(screen.queryByText(/plan upgrade/)).not.toBeInTheDocument();
  });
  it('resumes the server-returned transaction without a checkout-create request', async () => {
    const session = {
      provider: 'paddle',
      kind: 'overlay',
      attemptId: attempt.id,
      transactionId: 'txn_same',
      clientToken: 'synthetic',
      environment: 'sandbox',
    };
    vi.mocked(apiPost).mockImplementation(
      async (path) =>
        ({
          data: path.endsWith('/resume') ? session : { outcome: 'payment_in_progress' },
        }) as never,
    );
    render(<CheckoutAttemptNotice attempt={attempt} ownerId="w" onUpdated={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Resume checkout' }));
    await waitFor(() =>
      expect(launchCheckout).toHaveBeenCalledWith(
        session,
        expect.any(Object),
        expect.any(Function),
      ),
    );
    expect(vi.mocked(apiPost).mock.calls.some(([path]) => path === '/api/billing/checkout')).toBe(
      false,
    );
  });
  it('cancels only the displayed attempt and version', async () => {
    render(<CheckoutAttemptNotice attempt={attempt} ownerId="w" onUpdated={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel checkout' }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(
        `/api/billing/checkout/${attempt.id}/cancel`,
        { version: 2 },
        expect.any(Object),
      ),
    );
  });
  it('keeps the purchase visible when stopping cannot be confirmed', async () => {
    vi.mocked(apiPost).mockImplementation(async (path) => {
      if (path.endsWith('/cancel')) throw new Error('unknown');
      return { data: {} } as never;
    });
    render(<CheckoutAttemptNotice attempt={attempt} ownerId="w" onUpdated={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel checkout' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Cancellation is not confirmed');
    expect(screen.getByTestId('checkout-attempt-notice')).toBeInTheDocument();
  });
  it('a paid purchase offers status checking while fulfillment finishes', () => {
    render(
      <CheckoutAttemptNotice
        attempt={{ ...attempt, state: 'paid', canResume: false, canCancel: false }}
        ownerId="w"
        onUpdated={() => {}}
      />,
    );
    expect(screen.getByText(/payment is confirmed/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume checkout' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel checkout' })).not.toBeInTheDocument();
  });
  it('does not open checkout if the resume response arrives after unmount', async () => {
    let resolve!: (value: unknown) => void;
    const response = new Promise((r) => {
      resolve = r;
    });
    vi.mocked(apiPost).mockImplementation((path) =>
      path.endsWith('/resume') ? (response as never) : (Promise.resolve({ data: {} }) as never),
    );
    const view = render(
      <CheckoutAttemptNotice attempt={attempt} ownerId="w" onUpdated={() => {}} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Resume checkout' }));
    view.unmount();
    await act(async () => resolve({ data: { provider: 'paddle', transactionId: 'txn_old' } }));
    expect(launchCheckout).not.toHaveBeenCalled();
  });
  it('a new owner starts its own check while the previous request is still pending', async () => {
    vi.mocked(apiPost).mockImplementationOnce(() => new Promise(() => {}));
    const view = render(
      <CheckoutAttemptNotice attempt={attempt} ownerId="old" onUpdated={() => {}} />,
    );
    view.rerender(
      <CheckoutAttemptNotice
        attempt={{ ...attempt, id: '22222222-2222-4222-8222-222222222222' }}
        ownerId="new"
        onUpdated={() => {}}
      />,
    );
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(2));
  });
  it('backs off automatic checks and explicitly stops them after fifteen minutes', async () => {
    vi.useFakeTimers();
    render(<CheckoutAttemptNotice attempt={attempt} ownerId="w" onUpdated={() => {}} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16 * 60_000);
    });
    expect(screen.getByText(/Automatic checking has stopped/)).toBeInTheDocument();
    const count = vi.mocked(apiPost).mock.calls.length;
    expect(count).toBeLessThan(22);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(apiPost).toHaveBeenCalledTimes(count);
  });
});
