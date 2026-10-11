import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EmailClickRecorder } from '@/features/analytics/email-click-recorder';

import { MailboxLinkResolver } from './mailbox-link-resolver';

const TARGET = '00000000-0000-4000-8000-000000000001';

const { replace, post, params, mutate } = vi.hoisted(() => ({
  replace: vi.fn(),
  post: vi.fn().mockResolvedValue({}),
  mutate: vi.fn(),
  params: new URLSearchParams(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => params,
  usePathname: () => '/senders',
  useRouter: () => ({ replace, refresh: vi.fn() }),
}));

vi.mock('@/lib/api/client', () => ({
  apiPost: (...args: unknown[]) => post(...args),
}));

vi.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({
    me: {
      activeMailboxId: 'other',
      mailboxes: [{ id: TARGET, status: 'active' }],
    },
  }),
}));

vi.mock('./api/use-set-active-mailbox', () => ({
  useSetActiveMailbox: () => ({
    mutate,
    isError: false,
    isPending: false,
  }),
}));

/** The recorder replaces the URL while the dynamic resolver is still loading. */
function applyReplace(url: string): void {
  const hashAt = url.indexOf('#');
  const withoutHash = hashAt === -1 ? url : url.slice(0, hashAt);
  const queryAt = withoutHash.indexOf('?');
  const query = queryAt === -1 ? '' : withoutHash.slice(queryAt + 1);
  for (const key of [...params.keys()]) params.delete(key);
  for (const [key, value] of new URLSearchParams(query)) params.append(key, value);
}

describe('email click beside the mailbox resolver', () => {
  beforeEach(() => {
    replace.mockReset();
    replace.mockImplementation(applyReplace);
    post.mockClear();
    mutate.mockClear();
    for (const key of [...params.keys()]) params.delete(key);
    params.set('from', 'sync_complete');
    params.set('mailbox', TARGET);
    params.set('utm_source', 'email');
    params.set('utm_campaign', 'sync_complete');
    window.location.hash = '';
  });

  it('leaves mailbox so a late resolver still calls mutate(target)', async () => {
    const { rerender } = render(<EmailClickRecorder />);
    expect(params.get('mailbox')).toBe(TARGET);
    expect(params.has('from')).toBe(false);

    rerender(
      <>
        <EmailClickRecorder />
        <MailboxLinkResolver>
          <button>Inbox action</button>
        </MailboxLinkResolver>
      </>,
    );

    await waitFor(() => expect(mutate).toHaveBeenCalledWith(TARGET));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Inbox action' })).toBeNull();
  });
});
