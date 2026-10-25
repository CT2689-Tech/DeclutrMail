import { act, render, renderHook, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SenderDetailBackLink } from './sender-detail-back-link';
import { useSenderPane } from '../use-sender-pane';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock('@/features/auth/auth-provider', () => ({
  useOptionalAuth: () => ({ me: { user: { id: 'user-1' }, activeMailboxId: 'mailbox-1' } }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/senders');
});

describe('sender detail return context', () => {
  it('returns from a narrow sender page to the exact search, filters and sort without reopening it', () => {
    const original = '/senders?q=weekly+news&has_inbox_mail=true&sort=name&direction=asc';
    window.history.replaceState(null, '', `${original}&sender=selected`);
    const { result } = renderHook(() => useSenderPane());
    act(() => result.current.navigateTo('selected', 'replace'));
    const destination = router.replace.mock.calls[0]![0] as string;
    window.history.replaceState(null, '', destination);
    render(<SenderDetailBackLink senderId="selected" arrow />);
    expect(screen.getByRole('link', { name: '← Back to Senders' })).toHaveAttribute(
      'href',
      original,
    );
  });

  it('returns to Needs first review instead of the general directory', () => {
    const params = new URLSearchParams({ returnTo: '/senders?q=weekly&view=first-review' });
    window.history.replaceState(null, '', `/senders/selected?${params}`);
    render(<SenderDetailBackLink senderId="selected" arrow />);
    expect(screen.getByRole('link', { name: '← Back to first review' })).toHaveAttribute(
      'href',
      '/senders?q=weekly&view=first-review',
    );
  });

  it.each([
    'https://other.example/senders?q=weekly',
    '//other.example/senders',
    '/settings',
    '/senders/another',
    '/senders?view=guided&review=unowned',
    '/senders?sender=selected',
    '/senders?q=weekly&returnTo=https://other.example',
  ])('rejects unrelated or recursive return context: %s', (returnTo) => {
    window.history.replaceState(null, '', `/senders/selected?${new URLSearchParams({ returnTo })}`);
    render(<SenderDetailBackLink senderId="selected" />);
    expect(screen.getByRole('link', { name: 'Back to Senders' })).toHaveAttribute(
      'href',
      '/senders',
    );
  });
});
