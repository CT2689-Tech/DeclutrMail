import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MailboxLinkBoundary } from './mailbox-link-boundary';

const { replace, post } = vi.hoisted(() => ({
  replace: vi.fn(),
  post: vi.fn().mockResolvedValue({}),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () =>
    new URLSearchParams(
      'from=gmail_reconnect&mailbox=00000000-0000-4000-8000-000000000001&utm_source=email',
    ),
  useRouter: () => ({ replace }),
}));

vi.mock('next/dynamic', () => ({
  default: () =>
    function WithheldResolver() {
      return <p>Opening linked inbox…</p>;
    },
}));

vi.mock('@/lib/api/client', () => ({
  apiPost: (...args: unknown[]) => post(...args),
}));

describe('MailboxLinkBoundary email click', () => {
  it('records mailbox before the resolver withholds the page', () => {
    render(
      <MailboxLinkBoundary>
        <button>Inbox action</button>
      </MailboxLinkBoundary>,
    );
    expect(screen.queryByRole('button', { name: 'Inbox action' })).toBeNull();
    expect(post).toHaveBeenCalledWith('/api/v1/analytics/email-click', {
      template: 'gmail_reconnect',
      mailboxId: '00000000-0000-4000-8000-000000000001',
    });
    expect(JSON.stringify(post.mock.calls)).not.toContain('@');
  });
});
