import { Suspense, lazy } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LazyHomeVisitTracker } from './lazy-home-visit-tracker';
import { MailboxLinkBoundary } from '../mailboxes/mailbox-link-boundary';

const state = vi.hoisted(() => ({ target: true, replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(state.target ? 'mailbox=b' : ''),
  useRouter: () => ({ replace: state.replace }),
}));
vi.mock('next/dynamic', () => ({
  default: (load: () => Promise<React.ComponentType<{ children?: React.ReactNode }>>) =>
    lazy(async () => ({ default: await load() })),
}));
vi.mock('./api/use-home-visit', () => {
  throw new Error('Synthetic chunk download failure');
});
vi.mock('../mailboxes/mailbox-link-resolver', () => {
  throw new Error('Synthetic chunk download failure');
});

describe('failed journey chunk downloads', () => {
  it('keeps the app usable when optional tracking cannot load', async () => {
    render(
      <Suspense fallback={<p>Loading</p>}>
        <LazyHomeVisitTracker />
        <button>Inbox action</button>
      </Suspense>,
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Inbox action' })).toBeInTheDocument(),
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('keeps a linked inbox closed with recovery, then permits account controls after leaving the link', async () => {
    state.target = true;
    const view = render(
      <Suspense fallback={<p>Loading</p>}>
        <MailboxLinkBoundary>
          <button>Inbox action</button>
        </MailboxLinkBoundary>
      </Suspense>,
    );
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Reload'));
    expect(screen.queryByRole('button', { name: 'Inbox action' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Open Gmail accounts' })).toHaveAttribute(
      'href',
      '/settings#mailboxes',
    );
    state.target = false;
    view.rerender(
      <Suspense fallback={<p>Loading</p>}>
        <MailboxLinkBoundary>
          <button>Account controls</button>
        </MailboxLinkBoundary>
      </Suspense>,
    );
    expect(screen.getByRole('button', { name: 'Account controls' })).toBeInTheDocument();
  });
});
