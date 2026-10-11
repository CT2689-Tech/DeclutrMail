import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MailboxLinkResolver as MailboxLinkBoundary } from './mailbox-link-resolver';

const state = vi.hoisted(() => ({
  target: 'b' as string | null,
  active: 'a',
  status: 'active',
  error: false,
  pending: false,
  mutate: vi.fn(),
  replace: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () =>
    new URLSearchParams(
      state.target === null ? 'sender=test' : `mailbox=${state.target}&sender=test`,
    ),
  usePathname: () => '/senders',
  useRouter: () => ({ replace: state.replace }),
}));
vi.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({
    me: {
      activeMailboxId: state.active,
      mailboxes: [
        { id: 'b', status: state.status },
        { id: 'c', status: 'active' },
      ],
    },
  }),
}));
vi.mock('./api/use-set-active-mailbox', () => ({
  useSetActiveMailbox: () => ({
    mutate: state.mutate,
    isError: state.error,
    isPending: state.pending,
  }),
}));

beforeEach(() => {
  state.target = 'b';
  state.active = 'a';
  state.status = 'active';
  state.error = false;
  state.pending = false;
  vi.clearAllMocks();
});
const mount = () =>
  render(
    <MailboxLinkBoundary>
      <button>Inbox action</button>
    </MailboxLinkBoundary>,
  );

describe('mailbox links', () => {
  it('keeps scoped actions unmounted while selecting the owned target', async () => {
    mount();
    await waitFor(() => expect(state.mutate).toHaveBeenCalledWith('b'));
    expect(state.mutate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Inbox action' })).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Opening');
    fireEvent.click(screen.getByRole('button', { name: 'Continue with my current inbox' }));
    expect(state.replace).not.toHaveBeenCalled();
  });
  it('strips the target after resolution and retains the destination query', async () => {
    state.active = 'b';
    const view = mount();
    expect(screen.queryByRole('button', { name: 'Inbox action' })).toBeNull();
    await waitFor(() => expect(state.replace).toHaveBeenCalledWith('/senders?sender=test'));
    expect(state.mutate).not.toHaveBeenCalled();
    state.target = null;
    view.rerender(
      <MailboxLinkBoundary>
        <button>Inbox action</button>
      </MailboxLinkBoundary>,
    );
    expect(screen.getByRole('button', { name: 'Inbox action' })).toBeInTheDocument();
  });
  it.each(['foreign', 'disconnected', 'duplicate'])('never selects a %s inbox', (reason) => {
    if (reason === 'foreign') state.target = 'unknown';
    if (reason === 'disconnected') state.status = 'disconnected';
    if (reason === 'duplicate') state.target = 'b&mailbox=b';
    mount();
    expect(screen.getByText('This inbox link is unavailable')).toBeInTheDocument();
    expect(state.mutate).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Inbox action' })).toBeNull();
  });
  it.each(['c', 'unknown', null])(
    'withholds controls while an earlier target commits before %s',
    async (target) => {
      const view = mount();
      await waitFor(() => expect(state.mutate).toHaveBeenCalledWith('b'));
      state.pending = true;
      state.target = target;
      view.rerender(
        <MailboxLinkBoundary>
          <button>Inbox action</button>
        </MailboxLinkBoundary>,
      );
      expect(state.mutate).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: 'Continue with my current inbox' })).toBeDisabled();
      expect(screen.queryByRole('button', { name: 'Open Gmail accounts' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Inbox action' })).toBeNull();
      state.active = 'b';
      state.pending = false;
      view.rerender(
        <MailboxLinkBoundary>
          <button>Inbox action</button>
        </MailboxLinkBoundary>,
      );
      if (target === 'c') {
        await waitFor(() => expect(state.mutate).toHaveBeenLastCalledWith('c'));
        expect(state.mutate).toHaveBeenCalledTimes(2);
        expect(screen.queryByRole('button', { name: 'Inbox action' })).toBeNull();
      } else if (target === 'unknown')
        expect(screen.getByText('This inbox link is unavailable')).toBeInTheDocument();
      else expect(screen.getByRole('button', { name: 'Inbox action' })).toBeInTheDocument();
    },
  );

  it('offers explicit retry when switching fails and never exposes the old inbox', () => {
    const view = mount();
    state.error = true;
    view.rerender(
      <MailboxLinkBoundary>
        <button>Inbox action</button>
      </MailboxLinkBoundary>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(state.mutate).toHaveBeenLastCalledWith('b');
    expect(screen.queryByRole('button', { name: 'Inbox action' })).toBeNull();
  });
});
