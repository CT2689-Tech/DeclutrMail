import { afterEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { installFetchStub, resetFetchStub } from '@/test/fetch-stub';

let searchParams = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/onboarding',
  useSearchParams: () => searchParams,
}));

import OnboardingPage from './page';

afterEach(() => {
  resetFetchStub();
  searchParams = new URLSearchParams();
});

it('keeps an anonymous visitor on the promise and Connect steps until they choose Google', async () => {
  const originalLocation = window.location;
  const assign = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      pathname: '/onboarding',
      search: '',
      hash: '',
      href: 'http://localhost/onboarding',
      assign,
    },
  });
  installFetchStub([
    { method: 'GET', path: '/api/auth/me', respond: () => new Response(null, { status: 401 }) },
    {
      method: 'POST',
      path: '/api/auth/refresh',
      respond: () => new Response(null, { status: 401 }),
    },
  ]);
  try {
    const queryClient = createTestQueryClient();
    render(
      <QueryWrapper client={queryClient}>
        <OnboardingPage />
      </QueryWrapper>,
    );

    expect(
      screen.getByText('Clear thousands of emails by sender — and see exactly what moves.'),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(queryClient.getQueryState(['onboarding', 'session-probe'])?.status).toBe('error'),
    );
    expect(
      screen.getByText('Clear thousands of emails by sender — and see exactly what moves.'),
    ).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /Connect Gmail/ }));
    expect(await screen.findByText('Connect your Gmail.')).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
  } finally {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  }
});

it('still redirects an anonymous visitor from a protected secondary-connect entry', async () => {
  searchParams = new URLSearchParams('mailbox=mb2');
  const originalLocation = window.location;
  const assign = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      pathname: '/onboarding',
      search: '?mailbox=mb2',
      hash: '',
      href: 'http://localhost/onboarding?mailbox=mb2',
      assign,
    },
  });
  installFetchStub([
    { method: 'GET', path: '/api/auth/me', respond: () => new Response(null, { status: 401 }) },
    {
      method: 'POST',
      path: '/api/auth/refresh',
      respond: () => new Response(null, { status: 401 }),
    },
  ]);
  try {
    render(
      <QueryWrapper client={createTestQueryClient()}>
        <OnboardingPage />
      </QueryWrapper>,
    );
    await waitFor(() => expect(assign).toHaveBeenCalledOnce());
    expect(assign.mock.calls[0]?.[0]).toContain('/sign-in?returning=1');
  } finally {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  }
});
