import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAILBOX_SCOPE_RESET_EVENT } from '@/features/mailboxes/api/reset-mailbox-cache';
import { CleanupViewNavigation, CleanupWorkspace } from './cleanup-workspace';

const lifecycle = vi.hoisted(() => ({
  sendersMounts: 0,
  sendersUnmounts: 0,
  reviewMounts: 0,
  reviewUnmounts: 0,
  mailboxId: 'mailbox-a',
  tier: 'pro' as 'pro' | 'free',
  pending: undefined as number | undefined,
  shortcuts: [] as string[],
}));

vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');
  const subscribe = (listener: () => void) => {
    window.addEventListener('popstate', listener);
    return () => window.removeEventListener('popstate', listener);
  };
  const snapshot = () => window.location.search;
  return {
    useSearchParams: () => new URLSearchParams(useSyncExternalStore(subscribe, snapshot, snapshot)),
  };
});

vi.mock('next/dynamic', async () => {
  const { createElement, lazy, Suspense } = await import('react');
  return {
    default: (loader: () => Promise<React.ComponentType<Record<string, unknown>>>) => {
      const Component = lazy(async () => ({ default: await loader() }));
      return function DynamicChild(props: Record<string, unknown>) {
        return createElement(Suspense, { fallback: null }, createElement(Component, props));
      };
    },
  };
});

vi.mock('@/features/auth/auth-provider', () => ({
  useOptionalAuth: () => ({ me: { activeMailboxId: lifecycle.mailboxId, tier: lifecycle.tier } }),
}));
vi.mock('@/features/screener/api/use-screener', () => ({
  useCachedScreenerCount: () => lifecycle.pending,
}));

type SenderProps = {
  active?: boolean;
  guided?: boolean;
  navigation?: ReactNode;
  onStartGuided: () => void;
  onExitGuided: () => void;
};
vi.mock('@/features/senders/senders-screen', async () => {
  const { useEffect, useState } = await import('react');
  return {
    SendersScreen: ({ active, guided, navigation, onStartGuided, onExitGuided }: SenderProps) => {
      const [selection, setSelection] = useState('No selection');
      useEffect(() => {
        lifecycle.sendersMounts += 1;
        return () => {
          lifecycle.sendersUnmounts += 1;
        };
      }, []);
      useEffect(() => {
        if (!active) return;
        const onKey = (event: KeyboardEvent) => {
          if (event.key === 'x') lifecycle.shortcuts.push('senders');
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, [active]);
      return (
        <section data-testid="senders-owner" data-active={active} data-guided={guided}>
          {navigation}
          <p>{selection}</p>
          <button onClick={() => setSelection('Lumen selected')}>Select Lumen</button>
          <button onClick={onStartGuided}>Start guided review</button>
          <button onClick={onExitGuided}>Exit guided review</button>
        </section>
      );
    },
  };
});

vi.mock('@/features/senders/first-review-workspace', async () => {
  const { useEffect, useState } = await import('react');
  return {
    FirstReviewWorkspace: ({ active, navigation }: { active: boolean; navigation?: ReactNode }) => {
      const [preview, setPreview] = useState(false);
      useEffect(() => {
        lifecycle.reviewMounts += 1;
        return () => {
          lifecycle.reviewUnmounts += 1;
        };
      }, []);
      useEffect(() => {
        if (!active) return;
        const onKey = (event: KeyboardEvent) => {
          if (event.key === 'x') lifecycle.shortcuts.push('first-review');
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, [active]);
      return (
        <section data-testid="first-review-owner" data-active={active}>
          {navigation}
          <button onClick={() => setPreview(true)}>Open decision preview</button>
          {preview && <p>Decision preview pending</p>}
        </section>
      );
    },
  };
});

beforeEach(() => {
  window.history.replaceState(null, '', '/senders');
  lifecycle.sendersMounts = 0;
  lifecycle.sendersUnmounts = 0;
  lifecycle.reviewMounts = 0;
  lifecycle.reviewUnmounts = 0;
  lifecycle.mailboxId = 'mailbox-a';
  lifecycle.tier = 'pro';
  lifecycle.pending = undefined;
  lifecycle.shortcuts = [];
});

afterEach(() => {
  window.history.replaceState(null, '', '/senders');
});

async function visitFirstReview() {
  fireEvent.click(
    within(screen.getByTestId('senders-owner')).getByRole('link', { name: 'Needs first review' }),
  );
  return screen.findByTestId('first-review-owner');
}

describe('CleanupWorkspace owners and navigation', () => {
  it('mounts first review only when visited and keeps both action owners alive afterward', async () => {
    render(<CleanupWorkspace />);
    const senders = screen.getByTestId('senders-owner');
    fireEvent.click(within(senders).getByRole('button', { name: 'Select Lumen' }));
    expect(screen.queryByTestId('first-review-owner')).not.toBeInTheDocument();
    expect(lifecycle.reviewMounts).toBe(0);

    const review = await visitFirstReview();
    expect(lifecycle.sendersMounts).toBe(1);
    expect(lifecycle.sendersUnmounts).toBe(0);
    expect(lifecycle.reviewMounts).toBe(1);
    expect(senders.parentElement).toHaveAttribute('hidden');
    expect(senders.parentElement).toHaveAttribute('inert');
    expect(review.parentElement).not.toHaveAttribute('hidden');
    expect(review.parentElement).not.toHaveAttribute('inert');
    fireEvent.click(within(review).getByRole('button', { name: 'Open decision preview' }));

    fireEvent.click(within(review).getByRole('link', { name: 'All senders' }));
    expect(lifecycle.reviewUnmounts).toBe(0);
    expect(review.parentElement).toHaveAttribute('hidden');
    expect(review.parentElement).toHaveAttribute('inert');
    expect(senders.parentElement).not.toHaveAttribute('hidden');
    expect(within(senders).getByText('Lumen selected')).toBeInTheDocument();

    fireEvent.click(within(senders).getByRole('link', { name: 'Needs first review' }));
    expect(lifecycle.reviewMounts).toBe(1);
    expect(within(review).getByText('Decision preview pending')).toBeInTheDocument();
  });

  it('enables shortcuts only for the visible action owner, including guided mode', async () => {
    render(<CleanupWorkspace />);
    const senders = screen.getByTestId('senders-owner');
    fireEvent.keyDown(window, { key: 'x' });
    const review = await visitFirstReview();
    expect(senders).toHaveAttribute('data-active', 'false');
    expect(review).toHaveAttribute('data-active', 'true');
    fireEvent.keyDown(window, { key: 'x' });
    fireEvent.click(within(review).getByRole('link', { name: 'All senders' }));
    fireEvent.click(within(senders).getByRole('button', { name: 'Start guided review' }));
    expect(senders).toHaveAttribute('data-active', 'true');
    expect(senders).toHaveAttribute('data-guided', 'true');
    expect(review).toHaveAttribute('data-active', 'false');
    fireEvent.keyDown(window, { key: 'x' });
    expect(lifecycle.shortcuts).toEqual(['senders', 'first-review', 'senders']);
    expect(new URLSearchParams(window.location.search).get('view')).toBe('guided');
    fireEvent.click(within(senders).getByRole('button', { name: 'Exit guided review' }));
    expect(senders).toHaveAttribute('data-guided', 'false');
    expect(new URLSearchParams(window.location.search).has('view')).toBe(false);
  });

  it('preserves the sender query, filters, sort and hash across view changes', async () => {
    const search = '?q=lumen&sort=total&dir=asc&bucket=quiet&older=30';
    window.history.replaceState(null, '', `/senders${search}#sender-history`);
    render(<CleanupWorkspace />);
    const review = await visitFirstReview();
    const expected = new URLSearchParams(search);
    expected.set('view', 'first-review');
    expect(window.location.search).toBe(`?${expected.toString()}`);
    expect(window.location.hash).toBe('#sender-history');
    fireEvent.click(within(review).getByRole('link', { name: 'All senders' }));
    expect(window.location.search).toBe(search);
    expect(window.location.hash).toBe('#sender-history');
  });

  it('follows restored browser history without remounting an open first-review owner', async () => {
    render(<CleanupWorkspace />);
    const review = await visitFirstReview();
    fireEvent.click(within(review).getByRole('button', { name: 'Open decision preview' }));
    act(() => {
      window.history.replaceState(null, '', '/senders');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await waitFor(() => expect(review.parentElement).toHaveAttribute('hidden'));
    act(() => {
      window.history.replaceState(null, '', '/senders?view=first-review');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await waitFor(() => expect(review.parentElement).not.toHaveAttribute('hidden'));
    expect(lifecycle.reviewMounts).toBe(1);
    expect(lifecycle.reviewUnmounts).toBe(0);
    expect(within(review).getByText('Decision preview pending')).toBeInTheDocument();
  });

  it.each(['event', 'mailbox-id'] as const)(
    'returns to All senders while retaining action owners on a mailbox %s change',
    async (transition) => {
      const view = render(<CleanupWorkspace />);
      const review = await visitFirstReview();
      if (transition === 'event') {
        act(() => window.dispatchEvent(new Event(MAILBOX_SCOPE_RESET_EVENT)));
      } else {
        lifecycle.mailboxId = 'mailbox-b';
        view.rerender(<CleanupWorkspace />);
      }
      await waitFor(() => expect(review.parentElement).toHaveAttribute('hidden'));
      expect(review.parentElement).toHaveAttribute('inert');
      expect(review).toHaveAttribute('data-active', 'false');
      expect(lifecycle.reviewUnmounts).toBe(0);
      expect(new URLSearchParams(window.location.search).has('view')).toBe(false);
      const senders = screen.getByTestId('senders-owner');
      expect(senders).toHaveAttribute('data-active', 'true');
      expect(senders.parentElement).not.toHaveAttribute('hidden');
      await visitFirstReview();
      expect(lifecycle.reviewMounts).toBe(1);
    },
  );

  it('supports a direct first-review link without mounting it twice', async () => {
    window.history.replaceState(null, '', '/senders?view=first-review');
    render(<CleanupWorkspace />);
    const review = await screen.findByTestId('first-review-owner');
    expect(review).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('senders-owner')).toHaveAttribute('data-active', 'false');
    expect(lifecycle.sendersMounts).toBe(1);
    expect(lifecycle.reviewMounts).toBe(1);
  });

  it.each(['free', 'pro'] as const)(
    'only shows a cached pending count to the entitled %s tier',
    (tier) => {
      lifecycle.pending = 12;
      lifecycle.tier = tier;
      render(<CleanupWorkspace />);
      const badge = screen.queryByLabelText('12 senders awaiting first review');
      expect(badge !== null).toBe(tier === 'pro');
    },
  );
});

describe('CleanupViewNavigation', () => {
  it('omits an unknown count instead of fabricating zero', () => {
    render(<CleanupViewNavigation view="all" onChange={vi.fn()} />);
    expect(screen.getByRole('link', { name: 'Needs first review' })).not.toHaveTextContent('0');
    expect(screen.queryByLabelText(/senders awaiting first review/)).not.toBeInTheDocument();
  });

  it.each([0, 12])('shows an authoritative count of %s', (pending) => {
    render(<CleanupViewNavigation view="first-review" pending={pending} onChange={vi.fn()} />);
    expect(screen.getByLabelText(`${pending} senders awaiting first review`)).toHaveTextContent(
      String(pending),
    );
    expect(screen.getByRole('link', { name: /^Needs first review/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('owns an ordinary click and leaves modified link clicks to the browser', () => {
    const onChange = vi.fn();
    render(<CleanupViewNavigation view="all" onChange={onChange} />);
    const link = screen.getByRole('link', { name: 'Needs first review' });
    const ordinary = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    fireEvent(link, ordinary);
    expect(ordinary.defaultPrevented).toBe(true);
    expect(onChange).toHaveBeenCalledWith('first-review');
    onChange.mockClear();
    const modified = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
      metaKey: true,
    });
    fireEvent(link, modified);
    expect(modified.defaultPrevented).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('preserves scope in link targets for opening another tab', () => {
    render(
      <CleanupViewNavigation
        view="guided"
        search="q=lumen&sort=total&dir=asc&view=guided"
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('link', { name: 'All senders' })).toHaveAttribute(
      'href',
      '/senders?q=lumen&sort=total&dir=asc',
    );
    expect(screen.getByRole('link', { name: 'Needs first review' })).toHaveAttribute(
      'href',
      '/senders?q=lumen&sort=total&dir=asc&view=first-review',
    );
  });
});
